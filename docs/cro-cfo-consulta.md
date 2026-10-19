# Consulta de inscrição CRO/CFO

Data da verificação: 19/10/2026.

## Decisão

O preenchimento de nome, CRO e UF continua manual no perfil autenticado. Não há fonte autorizada para consulta automática. A API não chama o site público, não contorna CAPTCHA e não grava o perfil a partir de uma busca.

`GET /v1/dentists/cro-lookup` responde `unavailable` para UF e inscrição válidas. O corpo não traz nome, situação, especialidade, telefone nem e-mail. A busca pública não prova que a conta autenticada é a titular da inscrição.

## Fonte verificada

O Conselho Federal de Odontologia publica a busca em <https://busca-profissionais.cfo.org.br/>. A página institucional <https://website.cfo.org.br/busca-profissionais/> apenas encaminha para esse sistema. Em 19/10/2026 a tela pública oferecia estes filtros:

- CRO/UF
- categoria (cirurgião-dentista, técnico em prótese dentária, técnico em saúde bucal, auxiliar em saúde bucal, auxiliar de prótese dentária)
- número de inscrição
- especialidade
- habilitação
- nome

A mesma tela exibia a atualização da base em 19/10/2026. Não há, nessa página, documentação de API, autenticação, limite de taxa ou licença para uso por sistemas de terceiros. Os campos devolvidos por uma pesquisa não foram registrados, porque nenhuma consulta de profissional foi executada.

Não foi encontrado conjunto de dados abertos do CFO com inscritos em <https://dados.gov.br/>. A extranet descrita em <https://website.cfo.org.br/manual-de-uso-da-extranet/> é um módulo interno dos conselhos e inclui dados pessoais e financeiros. Não é canal autorizado para este produto.

<https://cfo.com.br/> é um serviço comercial de dados de empresas (CNPJ). Não é o Conselho Federal de Odontologia e não serve como fonte de inscrição profissional.

## Contrato até existir convênio

Entrada autenticada: UF e número de inscrição. A categoria fixa desta API é CD (cirurgião-dentista).

Estados possíveis: `found`, `not_found`, `ambiguous`, `unavailable`, `invalid_input`.

Enquanto não houver feed ou API institucional com termo de uso aceito, o único estado para entrada válida é `unavailable`, com `professional` nulo. `invalid_input` cobre UF fora da lista oficial ou inscrição vazia depois de remover pontuação. A resposta inclui a fonte, o instante da consulta e a categoria, sem inventar situação cadastral.

Quando um convênio existir, o adaptador deve ficar isolado deste módulo, com prazo de validade de cache explícito e sem tratar o resultado como prova de titularidade. Até lá não há cache de pessoa.
