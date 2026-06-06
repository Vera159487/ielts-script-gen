/**
 * 服务端通用工具函数
 */

/**
 * 标准化小红书链接
 * - 默认：移除追踪参数（share_id, share_from, share_channel, xsec_token, xsec_source）和 hash
 * - stripQuery=true：完全移除查询参数和 hash（用于去重比较）
 */
export function normalizeXHSLink(
  url: string,
  options?: { stripQuery?: boolean }
): string {
  try {
    const u = new URL(url);

    if (options?.stripQuery) {
      u.search = "";
      u.hash = "";
      return u.toString();
    }

    // 移除追踪参数
    const trackingParams = [
      "share_id",
      "share_from",
      "share_channel",
      "xsec_token",
      "xsec_source",
    ];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
