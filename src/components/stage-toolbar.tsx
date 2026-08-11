/**
 * Stage toolbar strip (build spec §3). The document-property controls
 * (size, edge-border toggle) arrive with the document-model build; the
 * contextual selection section with the selection build.
 */
export function StageToolbar() {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t bg-background px-3">
      <span className="text-sm text-muted-foreground">
        Document properties and selection controls
      </span>
    </div>
  )
}
