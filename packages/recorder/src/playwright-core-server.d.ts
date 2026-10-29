/**
 * The one piece of Playwright that is not public API and that the recorder
 * reads: the registry's answer to where a browser build is. Declared here to
 * the extent used, so a change in Playwright's shape fails the build and not
 * a user's `doctor`.
 */
declare module "playwright-core/lib/server" {
  export const registry: {
    findExecutable(
      name: string,
    ): { executablePath(): string | undefined } | undefined;
  };
}
