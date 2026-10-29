export function deviceInfo(agent = '') {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : '浏览器';
  const platform = /Windows/.test(agent)
    ? 'Windows'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Macintosh|Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '未知设备';
  const type = /iPad|Tablet/.test(agent)
    ? 'tablet'
    : /Mobile|Android|iPhone/.test(agent)
      ? 'mobile'
      : platform === '未知设备'
        ? 'unknown'
        : 'desktop';
  return {
    label: `${browser} · ${platform}`,
    type: type as 'desktop' | 'mobile' | 'tablet' | 'unknown',
  };
}
