# EcoConsciente Validator

Dashboard interno para validação de desafios de coleta seletiva submetidos por usuários da plataforma EcoConsciente.

## Como funciona

Quando um usuário submete um desafio no app, a API enfileira um job no Redis via BullMQ com os dados da submissão (foto, usuário, desafio, pontos). O Validator consome essa fila e exibe um painel para aprovação ou rejeição manual.

```
App mobile → POST /desafios/submissoes → API (NestJS) → Redis (BullMQ)
                                                               ↓
                                                    Validator (este serviço)
                                                               ↓
                                              PATCH /desafios/submissoes/:id/status
                                                               ↓
                                                  Pontos creditados ao usuário
```

## Stack

| Tecnologia | Uso |
|---|---|
| Node.js + TypeScript | Runtime |
| Express | Servidor HTTP |
| BullMQ + ioredis | Consumo da fila Redis |
| express-session | Autenticação por sessão |

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `4000` | Porta do servidor |
| `REDIS_URL` | `redis://localhost:6379` | URL de conexão com o Redis |
| `API_URL` | `http://localhost:3002` | URL base da econsciente-api |
| `SESSION_SECRET` | `eco-validator-secret` | Segredo da sessão HTTP |

## Rodando localmente

Necessário ter Redis rodando:

```bash
docker run -d --name redis-local -p 6379:6379 redis:7-alpine
```

Instalar dependências e iniciar:

```bash
npm install
npm run dev
```

Acesse `http://localhost:4000` e faça login com a conta ROOT da plataforma.

## Deploy com Docker

```bash
docker build -t econsciente-validator .
docker run -p 4000:4000 \
  -e REDIS_URL=redis://... \
  -e API_URL=https://sua-api.railway.app \
  -e SESSION_SECRET=sua-chave-secreta \
  econsciente-validator
```

Ou com Docker Compose (sobe Redis junto):

```bash
docker-compose up -d
```

> Em produção, o Validator e a API devem apontar para o **mesmo** Redis.

## Fluxo de validação

1. Acesse o dashboard — submissões pendentes aparecem como cards com foto, nome do usuário, desafio e pontuação
2. Clique em **Aprovar** para creditar os pontos ao usuário e remover o job da fila
3. Clique em **Rejeitar** para registrar a rejeição sem creditar pontos
4. O dashboard atualiza automaticamente a cada 30 segundos
