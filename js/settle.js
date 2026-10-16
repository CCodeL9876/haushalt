// Schuldenverrechnung: Wer hat mehr bezahlt, als ihm anteilig zusteht? Alle Beträge in ganzen Rappen/Cent.

// Saldo pro Person: positiv = bekommt Geld, negativ = schuldet Geld.
export function balances(members, expenses) {
  const bal = new Map(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    const split = (e.splitIds || []).filter((id) => bal.has(id));
    if (!bal.has(e.payerId) || !split.length) continue;
    bal.set(e.payerId, bal.get(e.payerId) + e.amount);
    // Gleichmässig aufteilen; übrige Rappen tragen die ersten Personen der Aufteilung
    const base = Math.floor(e.amount / split.length);
    let rest = e.amount - base * split.length;
    for (const id of split) {
      bal.set(id, bal.get(id) - base - (rest > 0 ? 1 : 0));
      rest -= 1;
    }
  }
  return bal;
}
