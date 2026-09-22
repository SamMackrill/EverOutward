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
