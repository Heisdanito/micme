package expo.modules.micmeaudio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

/**
 * Captures the mic and streams raw PCM16 (48 kHz mono, 20 ms frames) to the
 * desktop over a WebSocket. Reconnects on its own and drops audio instead of
 * piling up latency when the link is slow.
 */
class PcmStreamer(
  private val url: String,
  initialVoiceProcessing: Boolean,
  private val onState: (String, String?) -> Unit,
  private val onLevel: (Double) -> Unit,
) {
  companion object {
    const val SAMPLE_RATE = 48000
    const val FRAME_SAMPLES = 960 // 20 ms
    const val MAX_QUEUE_BYTES = 48000L // ~0.5 s; beyond this, frames are dropped
  }

  @Volatile var muted = false
  @Volatile private var voiceProcessing = initialVoiceProcessing
  @Volatile private var running = false
  @Volatile private var restartRecorder = false
  @Volatile private var socket: WebSocket? = null
  @Volatile private var open = false
  private var thread: Thread? = null

  private val client = OkHttpClient.Builder()
    .connectTimeout(4, TimeUnit.SECONDS)
    .pingInterval(5, TimeUnit.SECONDS)
    .build()

  fun start() {
    running = true
    connect()
    thread = Thread({ captureLoop() }, "micme-audio").also { it.start() }
  }

  fun stop() {
    running = false
    open = false
    socket?.close(1000, "stop")
    socket = null
    thread?.interrupt()
    thread = null
    onState("stopped", null)
  }

  fun setVoiceProcessing(on: Boolean) {
    if (on != voiceProcessing) {
      voiceProcessing = on
      restartRecorder = true
    }
  }

  private fun connect() {
    if (!running) return
    onState("connecting", null)
    socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        if (webSocket !== socket) return
        open = true
        onState("streaming", null)
      }

      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {}

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        lost(webSocket, if (reason.isNotEmpty()) reason else "closed")
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        lost(webSocket, t.message ?: "connection failed")
      }
    })
  }

  private fun lost(ws: WebSocket, reason: String) {
    if (ws !== socket) return
    open = false
    if (!running) return
    onState("retrying", reason)
    Thread {
      try {
        Thread.sleep(1000)
      } catch (_: InterruptedException) {
        return@Thread
      }
      if (running && ws === socket) connect()
    }.start()
  }

  @SuppressLint("MissingPermission")
  private fun createRecorder(): AudioRecord {
    val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val source = if (voiceProcessing) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.MIC
    val rec = AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(min, FRAME_SAMPLES * 2 * 4))
    if (voiceProcessing) {
      val id = rec.audioSessionId
      if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(id)?.enabled = true
      if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(id)?.enabled = true
      if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(id)?.enabled = true
    }
    return rec
  }

  private fun captureLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val frame = ShortArray(FRAME_SAMPLES)
    val bytes = ByteArray(FRAME_SAMPLES * 2)
    val silence = ByteArray(FRAME_SAMPLES * 2).toByteString()
    var rec: AudioRecord? = null
    var lastLevel = 0L
    try {
      rec = createRecorder()
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        onState("error", "Microphone is unavailable. Close other apps using the mic and try again.")
        return
      }
      rec.startRecording()
      while (running && !Thread.currentThread().isInterrupted) {
        if (restartRecorder) {
          restartRecorder = false
          rec?.stop()
          rec?.release()
          rec = createRecorder()
          rec.startRecording()
        }
        val r = rec ?: break
        var read = 0
        while (read < FRAME_SAMPLES && running) {
          val n = r.read(frame, read, FRAME_SAMPLES - read)
          if (n <= 0) break
          read += n
        }
        if (read < FRAME_SAMPLES) continue

        var peak = 0
        for (i in 0 until FRAME_SAMPLES) {
          val s = frame[i].toInt()
          peak = max(peak, abs(s))
          bytes[i * 2] = (s and 0xff).toByte()
          bytes[i * 2 + 1] = ((s shr 8) and 0xff).toByte()
        }

        val ws = socket
        if (open && ws != null && ws.queueSize() < MAX_QUEUE_BYTES) {
          ws.send(if (muted) silence else bytes.toByteString(0, bytes.size))
        }

        val now = System.currentTimeMillis()
        if (now - lastLevel > 100) {
          lastLevel = now
          onLevel(if (muted) 0.0 else peak / 32768.0)
        }
      }
    } catch (e: Exception) {
      if (running) onState("error", e.message ?: "Audio capture failed")
    } finally {
      try {
        rec?.stop()
      } catch (_: Exception) {
      }
      rec?.release()
    }
  }
}
