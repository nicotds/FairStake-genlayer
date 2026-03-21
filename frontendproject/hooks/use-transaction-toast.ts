'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

type TransactionState = 'idle' | 'signing' | 'pending' | 'ai-processing' | 'success' | 'error'

interface UseTransactionToastOptions {
  id: string
  state: TransactionState
  successMessage?: string
  errorMessage?: string
}

const messages: Record<TransactionState, string> = {
  idle: '',
  signing: 'Esperando firma...',
  pending: 'Transaccion enviada a Bradbury...',
  'ai-processing': 'La IA esta obteniendo datos de la fuente...',
  success: 'Operacion completada!',
  error: 'Error en la transaccion',
}

export function useTransactionToast({ id, state, successMessage, errorMessage }: UseTransactionToastOptions) {
  useEffect(() => {
    if (state === 'idle') return

    switch (state) {
      case 'signing':
        toast.loading(messages.signing, { id })
        break
      case 'pending':
        toast.loading(messages.pending, { id })
        break
      case 'ai-processing':
        toast.loading(messages['ai-processing'], { id })
        break
      case 'success':
        toast.success(successMessage || messages.success, { id })
        break
      case 'error':
        toast.error(errorMessage || messages.error, { id })
        break
    }
  }, [id, state, successMessage, errorMessage])
}

// Utility functions for direct toast calls
export const txToast = {
  signing: (id: string) => toast.loading('Esperando firma...', { id }),
  pending: (id: string) => toast.loading('Transaccion enviada a Bradbury...', { id }),
  aiProcessing: (id: string) => toast.loading('La IA esta obteniendo datos de la fuente...', { id }),
  success: (id: string, message = 'Operacion completada!') => toast.success(message, { id }),
  error: (id: string, message = 'Error en la transaccion') => toast.error(message, { id }),
  victory: (id: string) => toast.success('Victoria! Fondos reclamados.', { id }),
}
