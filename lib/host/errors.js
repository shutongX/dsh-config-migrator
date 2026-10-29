/** One error shape for HTTP and tool responses: code + message + status. */
export class MigratorError extends Error {
  /**
   * @param {string} code - machine-readable code (bad-request, not-found, forbidden, ...).
   * @param {string} message - human text shown by the panel.
   * @param {number} [status] - HTTP status the router answers with.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'MigratorError'
    this.code = code
    this.status = status
  }
}

/** Normalize any thrown value into a MigratorError. */
export function toMigratorError(error) {
  if (error instanceof MigratorError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new MigratorError('internal', message, 500)
}
