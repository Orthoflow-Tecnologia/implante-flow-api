# Implante Flow API

API clínica do prontuário [Implante Flow](https://github.com/Orthoflow-Resende/Implate-flow). Este repositório é o backend Node.js/Fastify. O aplicativo Flutter e a infraestrutura de deploy ficam em repositórios separados.

## Executar

Requer Node.js 24.

```bash
npm install
npm run dev
```

A API escuta em `http://127.0.0.1:3000`.

```bash
npm test
npm run typecheck
npm run build
npm start
```

Variáveis em [`.env.example`](.env.example). O processo lê o ambiente; não há arquivo `.env` carregado automaticamente.

## Contrato de execução

Este contrato é o que a infraestrutura ([F3S-466](https://linear.app/felpszip/issue/F3S-466/infra-ambientes-cicd-e-deploy-da-api-clinica)) deve usar para publicar o processo. Provisionamento, DNS, TLS, segredos e pipeline ficam fora deste repositório.

| Probe | Uso | Sucesso | Falha |
| --- | --- | --- | --- |
| `GET /health` | Liveness do processo | `200 {"status":"ok"}` | processo sem resposta |
| `GET /ready` | Readiness das dependências | `200 {"status":"ready"}` | `503 {"status":"unavailable"}` |

Os dois probes são públicos, não versionados e não consultam dado clínico. Não exigem `Authorization`. O orquestrador deve usar `/health` para reiniciar o processo e `/ready` para tirar a instância do balanceador.

`GET /v1` identifica o serviço. Rotas de negócio entram em `/v1` e, quando existirem, exigem o access token do WorkOS. Mudança incompatível de contrato abre `/v2`; os probes permanecem no mesmo caminho.

Cabeçalho `x-request-id` é devolvido em toda resposta. Se o valor recebido tiver entre 1 e 128 caracteres seguros (`A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `-`), ele é preservado. Caso contrário, a API gera um UUID.

Erro de cliente:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Requisição inválida.",
    "requestId": "req-123"
  }
}
```

Falha interna responde `500` com `code: "internal_error"` e a mensagem fixa `Erro interno.`. Log é JSON no stdout. `Authorization` e `Cookie` são removidos do log. O log não recebe nome de paciente, lote, foto nem corpo clínico.

OpenAPI: `GET /docs/json` e interface em `GET /docs`. Ficam desligados quando `APP_ENV=production`, a menos que `OPENAPI_ENABLED=true`.

A imagem `Dockerfile` escuta em `0.0.0.0:3000`, roda com usuário sem privilégio e já define o healthcheck em `/health`. `APP_ENV` e `PORT` devem ser injetados pelo ambiente. Segredo não entra na imagem nem no repositório.

| Variável | Default | Valores |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`, `staging`, `production`, `test` |
| `HOST` | `0.0.0.0` | endereço de bind |
| `PORT` | `3000` | `1`–`65535` |
| `LOG_LEVEL` | `info` (`silent` em `test`) | níveis do Pino |
| `OPENAPI_ENABLED` | `true` fora de `production` | `true`, `false` |
| `CORS_ORIGINS` | vazio | origens separadas por vírgula |
| `DATABASE_URL` | vazio | obrigatório em `staging` e `production` |

O processo aplica as migrations SQL de `migrations/` ao iniciar. `npm run migrate` faz o mesmo passo sem subir o HTTP. Consultas clínicas entram com `SET LOCAL ROLE implante_app` e `app.dentist_id`, sob row level security. O papel da aplicação não contorna essa política. `/ready` consulta o banco quando `DATABASE_URL` existe.

`SIGTERM` e `SIGINT` fecham o servidor antes do processo sair.
