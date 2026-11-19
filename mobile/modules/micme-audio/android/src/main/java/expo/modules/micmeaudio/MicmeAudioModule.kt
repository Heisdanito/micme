package expo.modules.micmeaudio

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MicmeAudioModule : Module() {
  private var streamer: PcmStreamer? = null

  override fun definition() = ModuleDefinition {
    Name("MicmeAudio")
    Events("onState", "onLevel")

    Function("start") { url: String, voiceProcessing: Boolean ->
      streamer?.stop()
      streamer = PcmStreamer(
        url = url,
        initialVoiceProcessing = voiceProcessing,
        onState = { state, message -> sendEvent("onState", mapOf("state" to state, "message" to message)) },
        onLevel = { level -> sendEvent("onLevel", mapOf("level" to level)) },
      ).also { it.start() }
    }

    Function("stop") {
      streamer?.stop()
      streamer = null
    }

    Function("setMuted") { muted: Boolean ->
      streamer?.muted = muted
    }

    Function("setVoiceProcessing") { on: Boolean ->
      streamer?.setVoiceProcessing(on)
    }

    OnDestroy {
      streamer?.stop()
      streamer = null
    }
  }
}
