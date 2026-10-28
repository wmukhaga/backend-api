// Explicit event life cycle. Anything not listed here is illegal.
export const EVENT_TRANSITIONS = {
  draft:     ['published', 'cancelled'],
  published: ['on_sale', 'cancelled'],
  on_sale:   ['sold_out', 'ongoing', 'cancelled'],
  sold_out:  ['on_sale', 'ongoing', 'cancelled'], // back to on_sale if holds expire / refunds
  ongoing:   ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const canMove = (from, to) => EVENT_TRANSITIONS[from]?.includes(to);
