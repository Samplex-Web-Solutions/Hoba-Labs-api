/**
 * Calculates a future date adding only business days (Monday - Friday).
 * @param {number} businessDaysToAdd 
 * @returns {Date}
 */
export function calculateTrialEndDate(businessDaysToAdd = 7) {
  let currentDate = new Date();
  let addedDays = 0;

  while (addedDays < businessDaysToAdd) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay();
    
    // 0 is Sunday, 6 is Saturday. Skip weekends!
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }
  return currentDate;
}