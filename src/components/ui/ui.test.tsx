import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Btn, Modal, Tabs, Badge, Input } from './index'

describe('UI library', () => {
  it('Btn fires onClick and renders label', () => {
    const onClick = vi.fn()
    render(<Btn onClick={onClick}>Save</Btn>)
    fireEvent.click(screen.getByText('Save'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('Modal shows children when open and hides when closed', () => {
    const { rerender } = render(<Modal open title="Hi">Body content</Modal>)
    expect(screen.getByText('Body content')).toBeInTheDocument()
    rerender(<Modal open={false} title="Hi">Body content</Modal>)
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()
  })

  it('Tabs switches on click', () => {
    const onChange = vi.fn()
    render(<Tabs value="a" onChange={onChange} tabs={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />)
    fireEvent.click(screen.getByText('B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('Badge renders its tone class', () => {
    const { container } = render(<Badge tone="success">OK</Badge>)
    expect(container.querySelector('.sm-badge-success')).toBeTruthy()
  })

  it('Input with digits strips non-digits and caps length', () => {
    function Harness() {
      const [v, setV] = useState('')
      return <Input digits={10} value={v} onChange={(e) => setV(e.target.value)} aria-label="phone" />
    }
    render(<Harness />)
    const input = screen.getByLabelText('phone') as HTMLInputElement
    fireEvent.change(input, { target: { value: '98765-43210 extra' } })
    expect(input.value).toBe('9876543210')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('maxlength', '10')
  })
})
