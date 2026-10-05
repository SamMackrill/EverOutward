// Reviewed visitor access: a road-to-island gap is not a walking route.
// Keep evidence with each exception so catalogue refreshes retain the rule.
/** @type {Record<string, {note: string, source: string}>} */
export const boatAccess = {
  "c5ab4c3d-40f4-416f-be3e-6c8c6d0ecf5c": {
    note: "Brownsea Island requires a boat crossing. Review the route to the departure point and add the boat journey separately.",
    source:
      "https://www.nationaltrust.org.uk/visit/dorset/brownsea-island/booking-your-visit-and-travelling-to-brownsea-island",
  },
  "fc6d6343-a51e-495f-ab03-f948a44acb55": {
    note: "Lundy requires a boat or helicopter transfer. Review the route to the departure point and add the transfer separately.",
    source: "https://www.landmarktrust.org.uk/lundyisland/timetable/",
  },
  "a214493d-04fc-4d14-bfdd-2ee77a747367": {
    note: "The Farne Islands require a boat trip from Seahouses. Review the route to the harbour and add the boat journey separately.",
    source: "https://www.nationaltrust.org.uk/visit/north-east/farne-islands",
  },
};

// Only reviewed special-open-day properties belong here. Ordinary seasonal
// hours, booking requirements and temporary closures do not exempt a place.
/** @type {Record<string, {note: string, source: string, assets: string[]}>} */
export const limitedAccess = {
  "207a7c87-e721-49cf-a5a9-f9d14cb7c821": {
    note: "The gatehouse is on school grounds. Public access is only available on special open days; check the announced dates before travelling.",
    source:
      "https://www.nationaltrust.org.uk/visit/cambridgeshire/ramsey-abbey-gatehouse",
    assets: ["Gatehouse"],
  },
  "b6a246c4-80f6-46a3-bcd2-209baaa2ab25": {
    note: "The dovecote and stables open on selected afternoons. The National Trust describes open afternoons on the last Sunday of the month, April to September, 2–5 pm. The grounds and car park are accessible at all times. Confirm the buildings’ opening dates before travelling.",
    source:
      "https://www.nationaltrust.org.uk/visit/essex-bedfordshire-hertfordshire/willington-dovecote-and-stables",
    assets: ["Dovecote", "Stables"],
  },
};

export const hasLimitedAccess = (place) =>
  !!(place?.limitedAccess || limitedAccess[place?.id]);

export function applyAccessRules(place) {
  const rule = limitedAccess[place.id];
  return rule
    ? {
        ...place,
        limitedAccess: true,
        limitedAccessNote: rule.note,
        accessSource: rule.source,
      }
    : place;
}
