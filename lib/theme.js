export function themeClass(businessType) {
  if (businessType === "takeaway" || businessType === "takeaway_seating") {
    return "theme-takeaway";
  }
  return "theme-restaurant";
}