import { T } from "gt-react";
import { cn } from "~/lib/utils";

import { PRODUCT_URLS } from "../productUrls";
import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `t3`, then run `command`. Both installers are shown
 * when configured because the browser showing this is often not the computer being set up.
 */
export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {PRODUCT_URLS.installUrl ? (
        <>
          <p className="text-xs text-muted-foreground">macOS, Linux</p>
          <CommandBlock command={`curl -fsSL ${PRODUCT_URLS.installUrl} | sh`} />
        </>
      ) : null}
      {PRODUCT_URLS.installPs1Url ? (
        <>
          <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
          <CommandBlock command={`irm ${PRODUCT_URLS.installPs1Url} | iex`} />
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        <T>Then</T>
      </p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        <T>
          Skip the install if you already have <code className="font-mono">t3</code>. If{" "}
          <code className="font-mono">t3</code> is not found after installing, add the folder the
          installer names to your PATH.
        </T>
      </p>
    </div>
  );
}
