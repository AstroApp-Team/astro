# Sprint 3 — Planejamento do MVP

Responde às perguntas do slide "Planejamento do Experimento" (Aula 9,
16/10/2026). Entrega da Sprint 3: apresentação em 23/10, relatório até 25/10.
Os números vêm do relatório consolidado das Sprints 1 e 2 ("Projeto de
Empreendedorismo - 26.2").

## Ponto de partida: o app veio antes da pergunta

A aula avisa que, quando construir fica barato, o grupo pula direto para o app
funcional e chega na banca com "artefato impressionante e evidência pobre". É
o nosso caso. O Astro já roda: a pessoa conversa por voz e vê o app sendo
montado na tela enquanto fala.

Então não vamos planejar o que construir. O que falta é a pergunta que esse
app precisa responder e a rodada com usuários que vai respondê-la. Daqui até a
banca, o trabalho é colocar o Astro na mão de pessoas reais, não adicionar
funcionalidade.

## A hipótese mais arriscada

Das Sprints 1 e 2 já sabemos que:

- o problema existe: 43 dos 141 respondentes têm ideias de app que não saem do
  papel pelo menos algumas vezes por ano;
- quem mais tem essas ideias não é quem nunca chegou perto de desenvolvimento.
  Quem já teve algum contato (níveis 2 a 4 da pesquisa) tem média entre 3,3 e
  4,25; quem nunca teve, 2,19. Por idade, o pico fica entre 19 e 44 anos;
- o que eles mais pedem é testar no próprio celular (41 respostas) e ajustar
  por voz (34);
- a dúvida mais repetida, tanto nos respondentes quanto no investidor anjo, é
  se o resultado presta: "vai ficar bom e funcional, ou vai ser um protótipo?"
- a aposta contrária do investidor é a diferenciação: a Rork já faz algo
  parecido e captou US$ 15 milhões. O relatório concluiu que o diferencial do
  Astro não é gerar por linguagem natural, é o ciclo de ajustar e ver o
  resultado na hora, no próprio aparelho.

A dúvida sobre qualidade é real, mas não é ela que este MVP consegue
responder. O Astro de hoje faz uma coisa simples de cada vez, sem
acabamento, e é pouco flexível. Testar se ele entrega um app pronto seria
testar o que ainda não foi construído, e a resposta já sabemos: não entrega.
Essa pergunta se responde construindo, não com um experimento com usuário.

O que este MVP consegue testar é o ciclo, que é o diferencial apontado acima.
A hipótese mais arriscada fica assim:

> **Uma pessoa que não programa, ao falar e ver a ideia dela tomar forma na
> hora, ainda que tosca, quer continuar.**

"Ainda que tosca" é de propósito. Se o ciclo só funciona quando o resultado é
polido, o Astro compete em qualidade de geração com a Rork e com o Lovable, e
perde. Se a pessoa se engaja mesmo com um rascunho, o polimento vira trabalho
de construção, que é a parte que a IA barateou.

"Quer continuar" se mede por comportamento, não por opinião: pedir para
mexer de novo outro dia, ou pedir o link para mostrar a alguém. Elogio no fim
da sessão não conta.

## Quem vamos chamar

Os primeiros usuários saem do grupo que a pesquisa apontou como mais
promissor: quem tem ideias com frequência, já teve algum contato com
desenvolvimento mas não programa (níveis 2 a 4) e tem entre 19 e 44 anos.
Entre os 43 que têm ideias com frequência, 15 se encaixam. É deles que saem as
8 sessões.

Ficam de fora desta rodada, de propósito:

- **Quem nunca teve contato com desenvolvimento** (69% da pesquisa). O
  relatório levanta que o Astro pode fazer essas pessoas começarem a ter
  ideias. É uma hipótese boa, mas é outra, e mais difícil de medir numa sessão.
- **Menores de idade**, como a persona Valentim. Precisaria de autorização dos
  responsáveis. O caso de uso dele (um joguinho para mostrar aos amigos) entra
  como sugestão de ideia no roteiro.

Hipóteses que ficam para depois, de propósito:

| Hipótese                                    | Por que não agora                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| O app gerado tem qualidade para uso real    | É uma questão de construção, não de cliente; o MVP de hoje não foi feito para isso             |
| Pagariam R$ 10–29/mês                       | A pesquisa já sustenta a faixa; falta ver alguém pagar, e isso só depois de o produto entregar |
| Voltam a usar sozinhos na semana seguinte   | Depende de a primeira sessão funcionar                                                         |
| Publicar na loja é um diferencial que vende | Hoje é feito na mão (ver abaixo); medimos o pedido, não a loja                                 |

## Que tipo de MVP, e por que não um mais barato

**Vibe coding + concierge.** O app funcional já existe, então usamos ele, mas
toda sessão é acompanhada por alguém do grupo, uma pessoa por vez.

Por que não algo mais barato:

- **Landing page / smoke test** mede interesse em cadastrar. Isso a pesquisa
  da Sprint 1 já mostrou. Não mostra como é a experiência de falar e ver.
- **Vídeo demo** mostra o ciclo de fora. A hipótese é sobre como a pessoa se
  sente estando nele.
- **Mágico de Oz puro** (alguém do grupo montando a tela por trás) não daria
  a resposta na hora, que é justamente o que está sendo testado. Como o app já
  roda, fingir sairia mais caro que usar.

E por que não deixar as pessoas usarem sozinhas: com 8 a 10 usuários, ver a
pessoa travar, repetir o pedido e desistir ensina mais que qualquer métrica de
uso. Também é uma questão de custo, já que a conversa por voz é cobrada por
minuto de sessão aberta.

## Critério de abandono (definido antes de rodar)

**Métrica única:** quantas pessoas, ao fim da sessão, pedem por conta própria
para continuar: mexer de novo outro dia ou receber o link para mostrar a
alguém. A gente não oferece nenhum dos dois.

Rodada de **8 sessões**:

| Resultado      | Decisão                                                               |
| -------------- | --------------------------------------------------------------------- |
| 4 ou mais de 8 | Hipótese se sustenta. Próxima rodada testa retorno e preço.           |
| 2 ou 3 de 8    | Inconclusivo. Ajustamos o que mais travou e rodamos mais 8.           |
| 1 ou nenhum    | Abandonamos a hipótese como está e reabrimos o problema (ver abaixo). |

O corte é metade, não maioria, porque a pessoa está vendo um rascunho de uma
ferramenta limitada. Metade pedindo mais nessas condições já é sinal forte.

Abandonar não quer dizer encerrar o Astro. Quer dizer voltar ao problema e
perguntar se o público certo é outro (por exemplo, só profissionais como o
Fábio, que precisam de algo para mostrar numa reunião) ou se a promessa
precisa ser menor (protótipo para mostrar, não app para usar).

Também anotamos em toda sessão, sem virar critério, os pontos em que a jornada
da Sprint 2 previa atrito:

- quantas vezes a pessoa precisou repetir um pedido porque não foi entendida;
- quantos ajustes ela fez depois da primeira versão;
- o que ela pediu e o Astro não conseguiu fazer (vira a lista do que construir
  primeiro);
- se ela preferiu falar ou pediu para digitar;
- o que ela disse que faria com o app.

## Cliente piloto

Além das 8 sessões, buscamos **um cliente piloto** no perfil da persona
Fábio: alguém que trabalha com produto, design ou inovação e precisa levar uma
ideia funcionando para uma reunião.

Com ele o compromisso é outro: construir junto um rascunho para uma
apresentação real que ele tenha marcada, e saber depois se ele levou o
rascunho para a reunião e como foi. Para o Fábio, um protótipo tosco que roda
já vale mais que um slide; é o caso em que a falta de acabamento menos pesa. Funciona como
prova de que o Astro resolve um caso real, e qualquer depoimento sai daí. É
também a persona que, segundo o relatório, pagaria mais.

Por que não a Carol, que era a primeira ideia: o caso dela é guardar dados de
pacientes e dividir o app com eles, e o MVP de hoje não guarda dados. Teríamos
que fazer isso na mão por trás, e aí o piloto testaria o grupo, não o Astro.
Ela volta quando essa parte existir.

Candidatos: a rede do grupo e o próprio investidor entrevistado, cujo time
gasta tempo justamente com ajustes de interface.

## O que vamos fazer na mão

Seguindo o "do things that don't scale":

| Etapa              | Como fica nesta rodada                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| Recrutamento       | Mensagem um a um para os 15 respondentes do perfil acima                     |
| Acesso             | Um de nós entrega o acesso pessoalmente; não existe cadastro                 |
| Primeira sessão    | Presencial ou por chamada, com alguém do grupo ao lado                       |
| Compartilhar o app | O grupo gera o link/QR e manda pelo WhatsApp quando a pessoa pede            |
| Publicar na loja   | Não existe na ferramenta. Se alguém pedir, o grupo empacota e entrega na mão |
| Ajustes depois     | A pessoa pede pelo WhatsApp e o grupo faz a alteração usando o próprio Astro |

Cada pedido que cai numa dessas linhas manuais é dado: mostra qual automação
vale a pena construir primeiro.

## Roteiro de uma sessão (~20 min)

1. **Antes (2 min).** Perguntar qual ideia de app ela já teve e não fez. Se não
   tiver nenhuma, sugerir um caso do Fábio (algo para mostrar numa reunião) ou
   do Valentim (um joguinho para mandar aos amigos). Avisar que vai sair um
   rascunho da primeira tela, não o app pronto. Expectativa alinhada evita
   medir frustração em vez de interesse.
2. **Construção (10–15 min).** Ela fala, o Astro monta, ela ajusta. Quem
   acompanha não ajuda a formular pedidos, só anota.
3. **Fechamento (3 min).** Perguntar "e agora, o que você faria com isso?" e
   esperar. Não oferecer o link. Registrar se ela pede.
4. **Uma semana depois.** Mensagem curta perguntando se mostrou para alguém.

## Cronograma proposto

| Quando        | O quê                                                         |
| ------------- | ------------------------------------------------------------- |
| 23/10         | Apresentar este plano na revisão da Sprint 3                  |
| 25/10         | Entregar relatório com este plano                             |
| 26/10 – 30/10 | Recrutar as 8 pessoas e o cliente piloto                      |
| 31/10 – 07/11 | Rodar as sessões                                              |
| 08/11         | Comparar o resultado com o critério acima e decidir           |
| Sprint 4      | Segunda rodada ou pivô, e o resultado vira evidência no pitch |

Cada volta começa reabrindo o problema, não só a lista de funcionalidades.
