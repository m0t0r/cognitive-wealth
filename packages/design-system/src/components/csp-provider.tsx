"use client";

// Not a shadcn component. Base UI renders a few inline `<style>` elements (Select's scrollbar rule,
// ScrollArea); wrap the app in this with the request's CSP nonce so they're allowed.
export { CSPProvider } from "@base-ui/react/csp-provider";
