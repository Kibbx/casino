import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { bingoData } from "../lib/gamesData";

export function BingoPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Bingo" breadcrumb="Events / Bingo" accentColor="#22c55e">
      <CardGrid>
        {bingoData.map((r, i) => (
          <CatalogCard key={r.id} game={r} delay={`${-i}s`} onClick={() => setLocation(r.route)} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
