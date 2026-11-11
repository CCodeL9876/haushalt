// Geld → Moneyflow: die gemeinsame Planung des Haushalts – gleicher Aufbau wie die persönliche Planung
// (js/views/planung.js), Daten aber im Haushalt (state.flow, js/planung.js useShared): alle sehen und bearbeiten sie.

import { makePlanView } from './planung.js';

export default makePlanView({ shared: true });
