import { BetDetail } from '@/components/bet-detail'

interface BetPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function BetPage({ params }: BetPageProps) {
  const { id } = await params
  return <BetDetail betId={id} />
}

export function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => ({
    title: `Apuesta #${id} | FairStake`,
    description: `Ver detalles de la apuesta #${id} en FairStake`,
  }))
}
