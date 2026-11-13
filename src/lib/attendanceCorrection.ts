/** Two saved-attendance changes in a month are stored only. The third and later email the owner. */
export const QUIET_ATTENDANCE_CHANGES = 2

export function attendanceChangeWarnsOwner(savesThisMonth: number): boolean {
  return savesThisMonth > QUIET_ATTENDANCE_CHANGES
}

export function attendanceBackupKey(classId: string, date: string, period: number, subject: string): string {
  return `att-backup:${classId}:${date}:${period}:${subject.trim().toLowerCase()}`
}

export function readAttendanceBackup(key: string): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function writeAttendanceBackup(key: string, marks: Record<string, string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(marks))
  } catch {
    /* a full browser store must not block the save */
  }
}
