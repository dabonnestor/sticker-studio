import { CatalogPanel } from "@/components/catalog-panel"
import { useStage } from "@/components/stage-context"

/**
 * The Graphics gallery (map #34, ticket #41 — Variant C): the
 * {@link CatalogPanel} bound to the Pixabay catalog and the Graphics copy.
 * See CatalogPanel for the gallery itself — this wrapper only owns the
 * binding and the copy.
 */
export function ArtworkPanel({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { graphicsCatalog } = useStage()
  return (
    <CatalogPanel
      active={active}
      onBack={onBack}
      catalog={graphicsCatalog}
      heading="Graphics"
      searchPlaceholder="Search graphics…"
      searchLabel="Search graphics"
      providerName="Pixabay"
      providerUrl="https://pixabay.com"
      noun="artwork"
      imageFit="cover"
    />
  )
}
