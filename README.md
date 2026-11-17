# Controle financeiro doméstico

Aplicação web para acompanhar receitas, despesas, contas a pagar e o resultado mensal de uma casa. O projeto usa Node.js/Express e PostgreSQL, executados em containers separados pelo Docker Compose.

## Funcionalidades

- Painel com receitas, despesas, saldo e contas pendentes.
- Cadastro e remoção de receitas e despesas.
- Cadastro de contas a pagar e opção para marcar como pagas ou pendentes.
- Relatório mensal com valores recebidos, gastos e totais por categoria.

## Tecnologias e arquitetura

- **Interface:** HTML, CSS e JavaScript.
- **API:** Node.js 20 e Express.
- **Banco de dados:** PostgreSQL 16.
- **Orquestração:** Docker Compose.

```text
Navegador
   | http://localhost:8000
   v
app (Node.js/Express) --- rede interna "backend" ---> db (PostgreSQL)
                                                    |
                                                    v
                                         volume nomeado "pgdata"
```

O serviço `app` é publicado na porta 8000 e se conecta ao banco usando o nome `db`. O Compose fornece resolução DNS interna pelo nome do serviço; por isso, `DB_HOST=db` funciona entre containers e não é necessário publicar a porta do PostgreSQL no computador hospedeiro. A rede `backend` é interna, e o banco não fica exposto diretamente ao host.

O volume nomeado `pgdata` guarda os arquivos do PostgreSQL fora do ciclo de vida dos containers. Assim, remover e recriar os containers não apaga os dados.

### Modelo de dados

- **`transacoes`**: descrição, valor, tipo (receita ou despesa), categoria e data. Uma transação pode referenciar uma conta.
- **`contas`**: descrição, valor, vencimento, estado de pagamento e data de pagamento.

Ao marcar uma conta como paga, a API cria uma despesa relacionada. Ao torná-la pendente novamente, essa despesa é removida.

## Pré-requisitos

- Git.
- Docker Desktop em execução (Windows/macOS) ou Docker Engine com o plugin Docker Compose (Linux).
- Docker Compose v2 (`docker compose`).

Não é necessário instalar Node.js nem PostgreSQL na máquina para executar o projeto.

## Executar a partir do GitHub

Depois de publicar o repositório, substitua `SEU_USUARIO` pelo usuário ou organização do GitHub:

```powershell
git clone https://github.com/SEU_USUARIO/controle-financeiro.git
cd controle-financeiro
Copy-Item .env.example .env
notepad .env
```

No `.env`, defina uma senha própria para `POSTGRES_PASSWORD`. Para build local, mantenha `DOCKERHUB_USER=local`; não é necessário ter uma conta no Docker Hub.

Em Linux/macOS, o comando para copiar o arquivo de exemplo é:

```sh
cp .env.example .env
```

Inicie os serviços na raiz do projeto:

```sh
docker compose up -d --build
```

Abra <http://localhost:8000>. Para confirmar que o app e o banco estão respondendo:

```sh
docker compose ps
curl http://localhost:8000/health
```

No PowerShell, se `curl` não estiver disponível como comando externo, use:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

## Comandos úteis

```sh
docker compose logs -f          # acompanhar logs; Ctrl+C sai do acompanhamento
docker compose restart          # reiniciar os serviços
docker compose down             # parar e remover containers/redes; mantém pgdata
docker compose up -d --build    # recriar/iniciar os serviços
```

**Não use `docker compose down -v` se quiser preservar os dados.** A opção `-v` remove também o volume do banco.

## Demonstração de persistência

1. Inicie o projeto e cadastre uma receita ou despesa pela interface.
2. Execute `docker compose down`.
3. Execute `docker compose up -d`.
4. Abra novamente <http://localhost:8000> e confirme que o registro continua presente.

Esse teste comprova a persistência no volume `pgdata`. Para zerar os dados intencionalmente, use `docker compose down -v`.

## API disponível

- `GET /health` — estado da conexão com o banco.
- `GET /api/resumo` — totais do painel.
- `/api/transacoes` — listar, cadastrar e remover transações.
- `/api/contas` — listar e cadastrar contas; as rotas também permitem atualizar o pagamento e remover contas.
- `GET /api/relatorio?mes=AAAA-MM` — relatório de um mês.

## Roteiro sugerido para a apresentação

1. Apresentar o problema resolvido, as funcionalidades e o modelo de dados.
2. Explicar por que Compose coordena serviços, redes, dependências e volumes em um único arquivo.
3. Mostrar `Dockerfile` e `docker-compose.yml`, destacando `DB_HOST=db`, a rede interna e o volume `pgdata`.
4. Demonstrar a aplicação e executar a prova de persistência descrita acima.

## Estrutura do projeto

```text
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── server.js
└── public/
    ├── app.js
    ├── index.html
    └── style.css
```
