export async function runStartup(
  start: () => void | Promise<void>,
  onFailure: (error: unknown) => void
): Promise<boolean> {
  try {
    await start();
    return true;
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Failure handling is terminal and must not create an unhandled rejection.
    }
    return false;
  }
}
