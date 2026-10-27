# Cadastro guiado do restaurante

Proposta de 27/10/2026. Não implementada. Imagem gerada no Gemini;
aguarda validação visual antes do esqueleto e das camadas de implementação.
Referência: [prancha da proposta](telas/propostas/cadastro-guiado-2026-10-27/cadastro-guiado-gemini.jpg).
Prompt, modelo e origem no JSON ao lado. Uma geração, chat Gemini 3.1 Pro,
esforço Alto; sem API paga. Mapa, nomes e distâncias são ilustrativos.
A marca e os textos finais seguem os componentes existentes. A amostra do
tour na prancha representa a etapa posterior ao primeiro item salvo.

O Felipe confirmou manter o design system atual: Rubik e vermelho. As
telas devem seguir os componentes e o comportamento responsivo do projeto.
Este documento define escopo e critérios; não comprova funcionalidade pronta.
O pagamento online continua desligado, sem alteração nesta proposta.

## Cadastro em quatro etapas

1. **Dados da conta:** aproveitar a etapa existente de identificação e senha.
   Não criar uma segunda conta a cada tentativa de concluir o cadastro.
2. **Restaurante:** nome, link, CEP, cidade, bairro, rua e número. O endereço
   deve resultar em um ponto de saída que a pessoa consiga conferir e
   corrigir. O CEP auxilia o preenchimento, mas não comprova a localização
   exata do estabelecimento nem substitui o número.
3. **Bairros:** carregar a lista disponível para a cidade escolhida,
   apresentar em ordem de distância do restaurante e permitir selecionar,
   revisar e corrigir a área atendida. Aplicar a regra de entrega já existente
   e o raio de 10 km; bairros fora do raio não podem entrar como atendidos.
   A apresentação deve distinguir dado ausente, bairro não selecionado e
   bairro fora da área. Não prometer uma lista completa de nomes populares.
4. **Horário:** configurar os sete dias, incluindo fechado, turnos que
   atravessam a meia-noite e repetição de horários entre dias. Conferir os
   termos antes de concluir. A conclusão cria a conta Auth, a loja, o vínculo
   do dono, as configurações e os bairros selecionados.

Voltar entre etapas deve conservar o que já foi preenchido. Uma mudança de
cidade invalida o ponto de saída e a lista anterior de bairros: ambos
precisam ser conferidos novamente antes de concluir. O tratamento do
rascunho não deve persistir senha em armazenamento aberto do navegador.

## Primeiro item obrigatório

Após o primeiro acesso de uma loja sem catálogo, abrir um modal obrigatório
para criar o primeiro item. O fluxo começa pela **categoria**, pois o
cadastro atual de produto exige uma categoria existente; depois pede nome
e preço do item e oferece salvar.

Enquanto o primeiro item não tiver gravação confirmada, bloquear cliques e
navegação para fora do fluxo, inclusive por Escape, atalhos e alteração das
rotas. Tab e Shift+Tab circulam pelos controles do próprio fluxo. O bloqueio
deve manter foco e interação dentro dele, permitindo sair da conta.
Ele não pode impedir o preenchimento ou prender o usuário sem saída.

Falha de gravação conserva o fluxo obrigatório e permite tentar novamente.
Recarregar retoma o estado necessário. Só liberar o painel depois que o item
estiver realmente salvo, sem gerar outra categoria ou outro item em duplo
clique ou repetição da tentativa. Lojas existentes com catálogo não devem
receber esse bloqueio.

Depois do primeiro item salvo, oferecer um tour opcional. O tour permite
avançar e pular, com progresso salvo para retomar ou reconhecer a conclusão.
Ele não substitui a confirmação de gravação do item.

## Endereços e lista de bairros

O [ViaCEP](https://viacep.com.br/) pode preencher CEP, município, bairro,
logradouro e código IBGE do município. Ele consulta um endereço por CEP;
não fornece a lista de todos os bairros da cidade. CEP genérico pode não
trazer bairro ou logradouro, e a tela precisa permitir completar os campos.
Não fazer varredura de CEPs para reconstruir uma base municipal.

Avaliar a malha de bairros do Censo 2022 do IBGE como origem de um cache
estático derivado por município, para carregar somente a cidade necessária.
Não realizar consultas em massa ao Nominatim para montar essa lista.

A auditoria do arquivo do Pará encontrou 362 registros de bairros em 25
municípios; Belém tem 71 registros, incluindo Curió-Utinga. Esses números
vieram da inspeção do ZIP, não de um dataset integrado ao app. O arquivo
baixado ficou somente em Temp; nenhum dataset dessa pesquisa entrou no
aplicativo. O arquivo nacional foi localizado, sem download nessa auditoria.

Essa malha representa os bairros cobertos pelo recorte oficial e não todos
os nomes populares. Pontos representativos derivados dos polígonos servem
para o cálculo atual em linha reta; não são endereço exato, percurso de
entrega ou distância rodoviária. A proposta precisa prever revisão e
correções manuais de nomes e pontos, mantendo clara a origem dos dados.

Fontes oficiais para avaliação:

- [Diretório do IBGE por UF](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/UF/).
- [Bairros do Pará — ZIP do IBGE](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/UF/PA_bairros_CD2022.zip).
- [Diretório nacional do IBGE](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/BR/).
- [Bairros do Brasil — ZIP do IBGE](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/BR/BR_bairros_CD2022.zip).

## Critérios de verificação antes de liberar

- CEP inválido, inexistente, genérico e sem bairro; serviço lento ou fora do
  ar. Uma resposta antiga não sobrescreve os dados de um CEP digitado depois.
- Troca de cidade descarta as referências anteriores de ponto e bairros,
  exige nova conferência e não mistura municípios de nomes semelhantes.
- Distâncias calculadas a partir do ponto conferido do restaurante e dos
  pontos dos bairros, respeitando a regra atual de taxa e o teto de 10 km.
  Distância em linha reta deve continuar identificável como tal.
- Horário inválido, dia fechado, repetição de horários e fechamento no dia
  seguinte, incluindo virada da semana. Não inventar novos limites de
  capacidade ou antecedência neste cadastro.
- Interrupção durante a criação, retorno e repetição com o mesmo identificador;
  disputa pelo mesmo link entre duas contas; duplo clique e rede lenta.
  Auth e Firestore não compartilham uma transação: a recuperação e o
  tratamento de contas órfãs precisam ser definidos e comprovados.
- Regras autorizam o lote que cria a nova loja junto com vínculo,
  configurações e bairros, conferindo o pai novo com `getAfter` quando
  necessário. Não ampliar acesso a outras lojas para viabilizar o lote.
- Primeiro item: falha não libera painel; recarga retoma; gravação confirmada
  libera; repetição não duplica; sair da conta permanece disponível;
  restaurante com catálogo existente não fica bloqueado.
- Teclado completo, Tab e Shift+Tab, Escape, mudança direta de rota, voltar
  e avançar; foco visível, mensagens de erro e retomada do tour opcional.
- Conferência em 390 e 1440 px, comparação com a imagem aprovada e console
  sem erros. Teste responsivo em Chromium não comprova Safari/iPhone real.

O próximo passo é validar a imagem e o fluxo. A implementação e os testes
acima permanecem pendentes; esta proposta não altera o cadastro atual.
