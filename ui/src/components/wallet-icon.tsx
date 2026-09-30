/** A wallet's own icon inside a fixed bordered frame. Extensions ship icons
 *  with different backgrounds (1AM's is white, Lace's dark), so the frame
 *  keeps them visually equal and stops a white icon vanishing on the page. */
export function WalletIcon({ icon, name }: { icon?: string; name: string }) {
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden border border-border bg-background">
      {icon ? (
        <img src={icon} alt="" className="h-full w-full object-contain" />
      ) : (
        <span className="text-[10px] font-extrabold">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
