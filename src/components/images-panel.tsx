import { CatalogPanel } from "@/components/catalog-panel"
import { useStage } from "@/components/stage-context"

/**
 * The Images gallery — the {@link CatalogPanel} bound to the Unsplash catalog
 * and the Images copy: the Graphics gallery's twin, sourcing photographs
 * instead of illustrated art. See CatalogPanel for the gallery itself — this
 * wrapper only owns the binding and the copy.
 */
export function ImagesPanel({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { imageCatalog } = useStage()
  return (
    <CatalogPanel
      active={active}
      onBack={onBack}
      catalog={imageCatalog}
      heading="Images"
      searchPlaceholder="Search images…"
      searchLabel="Search images"
      providerName="Unsplash"
      providerUrl="https://unsplash.com"
      noun="image"
      imageFit="cover"
    />
  )
}
