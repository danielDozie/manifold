import { useState } from 'react'
import { ChatIcon } from '@heroicons/react/outline'
import { ChatIcon as ChatIconSolid } from '@heroicons/react/solid'
import clsx from 'clsx'
import { Contract } from 'common/contract'
import { Modal, MODAL_CLASS, SCROLLABLE_MODAL_CLASS } from '../layout/modal'
import { Col } from '../layout/col'
import { CommentsTabContent } from '../contract/contract-tabs'
import { usePrivateUser } from 'web/hooks/use-user'
import { track, withTracking } from 'web/lib/service/analytics'
import { Tooltip } from '../widgets/tooltip'
import { User } from 'common/user'
import {
  useCommentsOnContract,
  useNumContractComments,
  useRealtimeCommentsOnContract,
} from 'web/hooks/use-comments-supabase'

export function SwipeComments(props: {
  contract: Contract
  setIsModalOpen: (open: boolean) => void
}) {
  const { contract, setIsModalOpen } = props
  const [open, setOpen] = useState(false)
  const setAllOpen = (open: boolean) => {
    setOpen(open)
    setIsModalOpen(open)
  }

  const comments = useRealtimeCommentsOnContract(contract.id) ?? []

  return (
    <button
      className={clsx('text-white active:text-gray-400 disabled:opacity-50')}
      onClick={withTracking(() => setAllOpen(true), 'view swipe comments', {
        contractId: contract.id,
      })}
    >
      <Col>
        <ChatIconSolid className="h-12 w-12" />
        <div className="mx-auto h-5 text-lg">
          {comments.length > 0 && comments.length}
        </div>
      </Col>

      <CommentsDialog contract={contract} open={open} setOpen={setAllOpen} />
    </button>
  )
}

export function CommentsButton(props: {
  contract: Contract
  user: User | null | undefined
}) {
  const { contract, user } = props

  const [open, setOpen] = useState(false)
  const totalComments = useNumContractComments(contract.id)

  return (
    <Tooltip text={`Comments`} placement="top" className={'z-10'}>
      <button
        disabled={totalComments === 0 && !user}
        className="hover:text-ink-600 text-ink-500 flex items-center gap-1.5 disabled:opacity-50"
        onClick={(e) => {
          e.preventDefault()
          setOpen(true)
          track('click feed card comments button', { contractId: contract.id })
        }}
      >
        <ChatIcon className="h-6 w-6" />
        {totalComments > 0 && (
          <div className="text-ink-500 h-5 align-middle text-sm disabled:opacity-50">
            {totalComments}
          </div>
        )}
        {open && (
          <CommentsDialog contract={contract} open={open} setOpen={setOpen} />
        )}
      </button>
    </Tooltip>
  )
}

function CommentsDialog(props: {
  contract: Contract
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const { contract, open, setOpen } = props
  const comments = useCommentsOnContract(contract.id) ?? []

  const privateUser = usePrivateUser()
  const blockedUserIds = privateUser?.blockedUserIds ?? []

  return (
    <Modal
      open={open}
      setOpen={setOpen}
      className={clsx('bg-canvas-0 rounded-lg pl-2 pr-4 pt-4')}
      size={'lg'}
    >
      <div className="mb-2 ml-2">
        Comments on <span className="font-bold">{contract.question}</span>
      </div>
      <Col className={clsx(SCROLLABLE_MODAL_CLASS, 'scrollbar-hide')}>
        <CommentsTabContent
          contract={contract}
          comments={comments}
          blockedUserIds={blockedUserIds}
        />
      </Col>
    </Modal>
  )
}
