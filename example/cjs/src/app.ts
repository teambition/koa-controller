const Koa = require('koa')
const { getRouterSync } = require('@tng/koa-controller')

const app = new Koa()

// Auto-scan and load controller files
app.use(getRouterSync({
  files: './src/api*.ts',
}).routes())

app.listen(4000, () => {
  console.log('CJS Example server running at http://localhost:4000')
})
