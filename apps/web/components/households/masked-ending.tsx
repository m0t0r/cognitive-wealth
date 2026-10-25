/** "••••0001", read out as "ending in 0001". */
export function MaskedEnding({ ending }: { ending: string }) {
  return (
    <>
      <span aria-hidden="true">••••</span>
      <span className="sr-only">ending in </span>
      {ending}
    </>
  );
}
