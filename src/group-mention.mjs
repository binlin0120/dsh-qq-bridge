// Accept only an actual OneBot @ segment for this logged-in QQ account.
// Display names, quoted text, @all and textual lookalikes grant no admission.
export function isExplicitSelfMention(event, selfUserId = '') {
  const selfId = String(selfUserId || event?.self_id || '');
  if (!/^[1-9]\d*$/.test(selfId) || !Array.isArray(event?.message)) return false;
  if (event.self_id != null && String(event.self_id) !== selfId) return false;
  return event.message.some((segment) => segment?.type === 'at'
    && String(segment.data?.qq ?? '') === selfId);
}
