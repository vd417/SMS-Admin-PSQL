/* ============================================================
   SchoolMate — Screen registry
   Each feature area exports a `screens` map of view-key -> component.
   They are merged here and consumed by the Router.
   ============================================================ */
import type { ComponentType } from 'react'
import { dashboardScreens } from './school/dashboard'
import { sisScreens } from './school/sis'
import { studentAddScreens } from './school/studentAdd'
import { examsScreens } from './school/exams'
import { academicsScreens } from './school/academics'
import { calendarScreens } from './school/calendar'
import { ptmScreens } from './school/ptm'
import { peopleScreens } from './school/people'
import { teacherAddScreens } from './school/teacherAdd'
import { staffAddScreens } from './school/staffAdd'
import { attendanceScreens } from './school/attendance'
import { transportScreens } from './school/transport'
import { financeScreens } from './school/finance'
import { opsScreens } from './school/operations'
import { portfolioScreens } from './owner/portfolio'
import { billingScreens } from './owner/billing'
import { revenueScreens } from './owner/revenue'
import { workspaceScreens } from './owner/workspace'
import { adminScreens } from './school/admin'

export const screenRegistry: Record<string, ComponentType> = {
  ...adminScreens,
  ...dashboardScreens,
  ...sisScreens,
  ...studentAddScreens,
  ...examsScreens,
  ...academicsScreens,
  ...calendarScreens,
  ...ptmScreens,
  ...peopleScreens,
  ...teacherAddScreens,
  ...staffAddScreens,
  ...attendanceScreens,
  ...financeScreens,
  ...transportScreens,
  ...opsScreens,
  ...portfolioScreens,
  ...billingScreens,
  ...revenueScreens,
  ...workspaceScreens,
}
