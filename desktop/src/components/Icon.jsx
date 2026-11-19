const PATHS = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.8 2.4M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></>,
  cam: <><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10 5-3v10l-5-3" /></>,
  camOff: <><path d="M16 16v.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6H6M10 6h4.5A1.5 1.5 0 0 1 16 7.5V11l5-3v9M3 3l18 18" /></>,
  flip: <><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" /><path d="M20 4v4h-4M4 20v-4h4" /></>,
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  usb: <><path d="M12 3v15M9 6l3-3 3 3M8 11v2a2 2 0 0 0 2 2h2M16 9v4a2 2 0 0 1-2 2h-2" /><circle cx="12" cy="19.5" r="1.5" /></>,
  wifi: <><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>,
  hotspot: <><circle cx="12" cy="12" r="2" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>,
  speaker: <><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  pin: <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  mirror: <><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 7 4 17h5zM15 7l5 10h-5z" /></>,
};

export function Icon({ name, size = 18, className, title }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
