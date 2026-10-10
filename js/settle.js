// Schuldenverrechnung: Wer hat mehr bezahlt, als ihm anteilig zusteht – und mit welchen
// möglichst wenigen Zahlungen ist alles ausgeglichen? Alle Beträge in ganzen Rappen/Cent.

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

// Vorschlag: jeweils die grösste Schuld mit dem grössten Guthaben verrechnen.
// Ergibt höchstens (Personen − 1) Zahlungen.
export function suggestTransfers(bal) {
  const debtors = [];
  const creditors = [];
  for (const [id, value] of bal) {
    if (value < 0) debtors.push({ id, value: -value });
    else if (value > 0) creditors.push({ id, value });
  }
  debtors.sort((a, b) => b.value - a.value);
  creditors.sort((a, b) => b.value - a.value);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].value, creditors[j].value);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].value -= amount;
    creditors[j].value -= amount;
    if (debtors[i].value === 0) i += 1;
    if (creditors[j].value === 0) j += 1;
  }
  return transfers;
}
