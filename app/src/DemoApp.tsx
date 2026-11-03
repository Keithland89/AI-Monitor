import { DashboardFrame } from './DashboardFrame'
import { useRoute } from './routes'

export function DemoApp() {
  const [route, go] = useRoute()
  return <DashboardFrame route={route} go={go} demo />
}
