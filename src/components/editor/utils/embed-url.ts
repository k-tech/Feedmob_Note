export function parseEmbedUrl(input: string) {
  const value = input.trim();
  // A bare domain ("example.com/page") is accepted as https, like typed links.
  const url = new URL(/^[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/.test(value) ? 'https://' + value : value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请使用完整的 http:// 或 https:// 链接。');
  const host = url.hostname.toLowerCase();
  let type: 'figma' | 'video' | 'bookmark' = 'bookmark';
  let embedUrl = url.href;
  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    type = 'figma';
    embedUrl = 'https://www.figma.com/embed?embed_host=feedmob&url=' + encodeURIComponent(url.href);
  } else if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be' ? parts[0] : url.searchParams.get('v') ?? (['embed', 'shorts'].includes(parts[0]) ? parts[1] : null);
    if (id && /^[\w-]{11}$/.test(id)) { type = 'video'; embedUrl = 'https://www.youtube.com/embed/' + id; }
  } else if ((host === 'loom.com' || host === 'www.loom.com') && /^\/(share|embed)\/[\w-]+/.test(url.pathname)) {
    type = 'video'; embedUrl = 'https://www.loom.com/embed/' + url.pathname.split('/')[2];
  }
  return { src: url.href, type, embedUrl, isVideoFile: /\.mp4$/i.test(url.pathname) };
}
