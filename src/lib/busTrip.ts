/** A pickup or drop the driver app already started. Idle and maintenance are not a trip. */
export function tripIsLive(status: string | undefined): boolean {
  return status === 'running' || status === 'on_route' || status === 'at_stop' || status === 'delayed'
}
