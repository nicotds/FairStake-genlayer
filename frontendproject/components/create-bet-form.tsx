'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarIcon, Sparkles, Loader2, CheckCircle2, XCircle, ArrowLeft, Coins } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useBetContract, useSimulateAI } from '@/hooks/use-bet-contract'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const createBetSchema = z.object({
  criteria: z
    .string()
    .min(20, 'El criterio debe tener al menos 20 caracteres')
    .max(500, 'El criterio no puede exceder 500 caracteres'),
  sourceUrl: z
    .string()
    .url('Ingresa una URL valida')
    .refine((url) => {
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    }, 'URL invalida'),
  deadline: z.date({
    required_error: 'Selecciona una fecha limite',
  }).refine((date) => date > new Date(), 'La fecha debe ser en el futuro'),
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, 'El monto debe ser mayor a 0')
    .refine((val) => parseFloat(val) <= 1000, 'El monto maximo es 1000 GEY'),
})

type CreateBetFormData = z.infer<typeof createBetSchema>

export function CreateBetForm() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { createBet, isWriting, isConfirming, isConfirmed } = useBetContract()
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResult, setSimulationResult] = useState<{ understood: boolean; reasoning: string } | null>(null)

  const form = useForm<CreateBetFormData>({
    resolver: zodResolver(createBetSchema),
    defaultValues: {
      criteria: '',
      sourceUrl: '',
      amount: '',
    },
  })

  const watchedCriteria = form.watch('criteria')
  const watchedSourceUrl = form.watch('sourceUrl')

  const handleSimulateAI = async () => {
    const criteria = form.getValues('criteria')
    const sourceUrl = form.getValues('sourceUrl')

    if (criteria.length < 20) {
      toast.error('El criterio debe tener al menos 20 caracteres')
      return
    }

    try {
      new URL(sourceUrl)
    } catch {
      toast.error('Ingresa una URL valida')
      return
    }

    setIsSimulating(true)
    toast.loading('La IA esta analizando el criterio...', { id: 'ai-simulation' })

    // Simulate AI processing (in production, this would call the contract)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Mock AI response
    const mockResponse = {
      understood: criteria.length > 30 && sourceUrl.includes('http'),
      reasoning: criteria.length > 30 
        ? `Entendido. Verificare si "${criteria.slice(0, 50)}..." se cumple consultando la fuente ${new URL(sourceUrl).hostname}. El criterio es claro y verificable.`
        : 'El criterio es demasiado corto o ambiguo. Recomiendo ser mas especifico para una verificacion precisa.',
    }

    setSimulationResult(mockResponse)
    setIsSimulating(false)
    toast.success('Simulacion completada', { id: 'ai-simulation' })
  }

  const onSubmit = async (data: CreateBetFormData) => {
    if (!isConnected) {
      toast.error('Conecta tu wallet para crear una apuesta')
      return
    }

    toast.loading('Esperando firma...', { id: 'create-bet' })

    try {
      await createBet({
        criteria: data.criteria,
        sourceUrl: data.sourceUrl,
        deadline: Math.floor(data.deadline.getTime() / 1000),
        amount: data.amount,
      })

      toast.loading('Transaccion enviada a Bradbury...', { id: 'create-bet' })
      
      // In production, wait for confirmation and redirect
      setTimeout(() => {
        toast.success('Desafio creado exitosamente!', { id: 'create-bet' })
        router.push('/')
      }, 2000)
    } catch (error) {
      toast.error('Error al crear la apuesta', { id: 'create-bet' })
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <Button asChild variant="ghost" className="mb-4 -ml-2">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al Marketplace
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Crear Desafio</h1>
        <p className="text-muted-foreground mt-2">
          Define un criterio verificable y deja que la IA determine el resultado
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Criterio de Verificacion</CardTitle>
            <CardDescription>
              Describe claramente que condicion debe cumplirse para ganar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Textarea
                placeholder="Ej: El precio de Bitcoin superara los $100,000 USD segun CoinGecko antes de la fecha limite"
                className="min-h-[100px] resize-none"
                {...form.register('criteria')}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className={watchedCriteria.length < 20 ? 'text-destructive' : ''}>
                  Minimo 20 caracteres
                </span>
                <span className={watchedCriteria.length > 500 ? 'text-destructive' : ''}>
                  {watchedCriteria.length}/500
                </span>
              </div>
              {form.formState.errors.criteria && (
                <p className="text-sm text-destructive">{form.formState.errors.criteria.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">URL de Verificacion</label>
              <Input
                type="url"
                placeholder="https://www.coingecko.com/en/coins/bitcoin"
                {...form.register('sourceUrl')}
              />
              {form.formState.errors.sourceUrl && (
                <p className="text-sm text-destructive">{form.formState.errors.sourceUrl.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* AI Simulation Preview */}
        <Card className="border-violet/30 bg-violet/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet" />
              Vista Previa de IA
            </CardTitle>
            <CardDescription>
              Simula como la IA interpretara tu criterio antes de apostar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              onClick={handleSimulateAI}
              disabled={isSimulating || watchedCriteria.length < 20 || !watchedSourceUrl}
              className="w-full border-violet/50 hover:bg-violet/10 hover:border-violet"
            >
              {isSimulating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analizando...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Simular Logica de IA
                </>
              )}
            </Button>

            {simulationResult && (
              <div className="mt-4 terminal-text rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {simulationResult.understood ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                  <span className="text-sm font-mono text-violet">
                    {simulationResult.understood ? 'CRITERIO ENTENDIDO' : 'REQUIERE MEJORAS'}
                  </span>
                </div>
                <p className="text-sm font-mono text-muted-foreground leading-relaxed">
                  {simulationResult.reasoning}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Detalles de la Apuesta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Fecha Limite</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !form.watch('deadline') && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.watch('deadline') ? (
                        format(form.watch('deadline'), 'PPP', { locale: es })
                      ) : (
                        'Seleccionar fecha'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.watch('deadline')}
                      onSelect={(date) => date && form.setValue('deadline', date, { shouldValidate: true })}
                      disabled={(date) => date < new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {form.formState.errors.deadline && (
                  <p className="text-sm text-destructive">{form.formState.errors.deadline.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Monto (GEY)</label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000"
                    placeholder="1.00"
                    className="pl-10"
                    {...form.register('amount')}
                  />
                </div>
                {form.formState.errors.amount && (
                  <p className="text-sm text-destructive">{form.formState.errors.amount.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => router.push('/')}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={!isConnected || isWriting || isConfirming}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isWriting || isConfirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando...
              </>
            ) : (
              'Crear Desafio'
            )}
          </Button>
        </div>

        {!isConnected && (
          <p className="text-center text-sm text-muted-foreground">
            Conecta tu wallet para crear un desafio
          </p>
        )}
      </form>
    </div>
  )
}
