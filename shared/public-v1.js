export function toPublicV1(data) {
  const copy = JSON.parse(JSON.stringify(data));
  copy.serviceStatuses = (copy.serviceStatuses || [])
    .filter(st => st && st.published === true)
    .map(st => {
      const { history, ...rest } = st;
      return rest;
    });
  return copy;
}
