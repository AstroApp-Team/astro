# Sprint 3 — Planejamento do MVP

Responde às perguntas do slide "Planejamento do Experimento" (Aula 9,
16/10/2026). Entrega da Sprint 3: apresentação em 23/10, relatório até 25/10.

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
- o que eles mais pedem é testar no próprio celular (41 respostas) e ajustar
  por voz (34);
- a dúvida mais repetida, tanto nos respondentes quanto no investidor anjo, é
  se o resultado presta: "vai ficar bom e funcional, ou vai ser um protótipo?"

A hipótese mais arriscada é essa última, porque se ela cair o resto não importa:

> **Uma pessoa sem conhecimento técnico, só conversando por voz, sai de uma
> sessão curta com um app que ela considera dela e quer mostrar para alguém.**

"Quer mostrar para alguém" é a parte que importa. Achar bonito é opinião,
pedir o link para mandar a um amigo é comportamento.

Hipóteses que ficam para depois, de propósito:

| Hipótese                                    | Por que não agora                                              |
| ------------------------------------------- | -------------------------------------------------------------- |
| Pagariam R$ 10–29/mês                       | Não faz sentido testar preço de algo que ainda não entrega     |
| Voltam a usar sozinhos na semana seguinte   | Depende de a primeira sessão funcionar                         |
| Publicar na loja é um diferencial que vende | Hoje é feito na mão (ver abaixo); medimos o pedido, não a loja |

## Que tipo de MVP, e por que não um mais barato

**Vibe coding + concierge.** O app funcional já existe, então usamos ele, mas
toda sessão é acompanhada por alguém do grupo, uma pessoa por vez.

Por que não algo mais barato:

- **Landing page / smoke test** mede interesse em cadastrar. Isso a pesquisa
  da Sprint 1 já mostrou. Não responde se o resultado presta.
- **Vídeo demo** mostra o melhor caso, editado. A dúvida do investidor é
  justamente sobre o caso comum.
- **Mágico de Oz puro** (alguém do grupo fazendo o app por trás) testaria a
  vontade, mas não a capacidade da ferramenta. Como o app já roda, fingir
  sairia mais caro que usar.

E por que não deixar as pessoas usarem sozinhas: com 8 a 10 usuários, ver a
pessoa travar, repetir o pedido e desistir ensina mais que qualquer métrica de
uso. Também é uma questão de custo, já que a conversa por voz é cobrada por
minuto de sessão aberta.

## Critério de abandono (definido antes de rodar)

**Métrica única:** quantas pessoas, ao fim da sessão, pedem o link ou o QR do
app para mandar para outra pessoa, sem a gente oferecer.

Rodada de **8 sessões**:

| Resultado       | Decisão                                                               |
| --------------- | --------------------------------------------------------------------- |
| 5 ou mais de 8  | Hipótese se sustenta. Próxima rodada testa retorno e preço.           |
| 3 ou 4 de 8     | Inconclusivo. Ajustamos o que mais travou e rodamos mais 8.           |
| 2 ou menos de 8 | Abandonamos a hipótese como está e reabrimos o problema (ver abaixo). |

Abandonar não quer dizer encerrar o Astro. Quer dizer voltar ao problema e
perguntar se o público certo é outro (por exemplo, quem já é técnico e quer
velocidade, como o Fábio da persona) ou se a promessa precisa ser menor
(protótipo para mostrar, não app para usar).

Também anotamos em toda sessão, sem virar critério:

- em que momento a pessoa travou ou repetiu um pedido;
- se ela preferiu falar ou pediu para digitar;
- o que ela disse que faria com o app.

## Cliente piloto

Além das 8 sessões, buscamos **um cliente piloto** com um problema concreto,
no perfil da persona Carol: profissional autônomo (saúde, direito, serviços)
que hoje resolve algo do trabalho com arquivos soltos no WhatsApp.

Com ele o compromisso é outro: construir junto, em uma ou duas conversas, algo
que ele use de fato na semana seguinte. Funciona como prova de que o Astro
resolve um caso real, e qualquer depoimento sai daí.

Candidatos: os profissionais de saúde e direito da pesquisa da Sprint 1 e a
rede do grupo.

## O que vamos fazer na mão

Seguindo o "do things that don't scale":

| Etapa              | Como fica nesta rodada                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| Recrutamento       | Mensagem um a um para os 43 respondentes que têm ideias com frequência       |
| Acesso             | Um de nós entrega o acesso pessoalmente; não existe cadastro                 |
| Primeira sessão    | Presencial ou por chamada, com alguém do grupo ao lado                       |
| Compartilhar o app | O grupo gera o link/QR e manda pelo WhatsApp quando a pessoa pede            |
| Publicar na loja   | Não existe na ferramenta. Se alguém pedir, o grupo empacota e entrega na mão |
| Ajustes depois     | A pessoa pede pelo WhatsApp e o grupo faz a alteração usando o próprio Astro |

Cada pedido que cai numa dessas linhas manuais é dado: mostra qual automação
vale a pena construir primeiro.

## Roteiro de uma sessão (~20 min)

1. **Antes (2 min).** Perguntar qual ideia de app ela já teve e não fez. Se não
   tiver nenhuma, sugerir uma das três personas.
2. **Construção (10–15 min).** Ela fala, o Astro monta. Quem acompanha não
   ajuda a formular pedidos, só anota.
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
