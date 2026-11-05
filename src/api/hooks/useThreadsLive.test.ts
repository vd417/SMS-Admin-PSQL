import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { bumpThreadsLiveQueries, noticeFromLiveEvent, noticeIsForCurrentUser, destinationForNotice } from './useThreadsLive'

describe('bumpThreadsLiveQueries', () => {
  it('invalidates the thread list and every open thread\'s messages', () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    bumpThreadsLiveQueries(qc)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.threads.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['threads', 'messages'] })
  })
})

describe('noticeFromLiveEvent', () => {
  it('reads a notification payload and ignores chat', () => {
    expect(noticeFromLiveEvent({ type: 'chat', data: { thread_id: '1' } })).toBeNull()
    expect(noticeFromLiveEvent({
      type: 'notification',
      data: { id: 'n1', user_id: 'user-1', title: 'Owner', body: 'Hello', tone: 'chat', icon: 'chatbubbles' },
    })).toEqual({
      id: 'n1', userId: 'user-1', title: 'Owner', body: 'Hello', tone: 'chat', icon: 'chatbubbles',
    })
  })

  it('shows a school-wide notice to everyone and a direct notice only to that user', () => {
    const school = { id: 'n1', userId: null, title: 'Event', body: '', tone: 'brand', icon: 'bell' }
    const direct = { ...school, userId: 'abc' }
    expect(noticeIsForCurrentUser(school, 'other')).toBe(true)
    expect(noticeIsForCurrentUser(direct, 'ABC')).toBe(true)
    expect(noticeIsForCurrentUser(direct, 'other')).toBe(false)
    expect(destinationForNotice('chat', 'chatbubbles')).toBe('school.comm')
    expect(destinationForNotice('brand', 'calendar')).toBe('school.calendar')
  })
})
