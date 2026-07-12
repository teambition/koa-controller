import Koa from 'koa'
import { getRouterAsync } from '@tng/koa-controller'

const app = new Koa()

// Auto-scan and load controller files using async import()
const router = await getRouterAsync({
  files: './src/api*.ts',
})
app.use(router.routes())

app.listen(4000, () => {
  console.log('ESM Example server running at http://localhost:4000')
})
