# Подключение DARYA HANDMADE к Vercel

## Подключение и публикация завершены

Сайт опубликован на https://darya-handmade.vercel.app. Vercel подтвердил `READY`, `PROMOTED`, назначение основного домена и отсутствие ошибок. Публичный HTML побайтово совпадает с подготовленным `index.html`: 21 товар, все изображения, TOON ART и `@Daria_Alexsandrowna`.

- Проект: `darya-handmade`, `prj_v2mBZNSdRv7xWSIRGGHn0gRummUu`.
- Команда: `team_7TJgvhnCy8TvGNDdQnWAPsGB`.
- Production-деплой: `dpl_5Jq8KLXspR8qkLMDPHpFnVc58coX`.
- Источник: Git-коммит `d017164779ed92050af28811386f44b3efa8bee7`, ветка `review/published-html-sync`.
- Vercel Dashboard: https://vercel.com/darya23/darya-handmade/5Jq8KLXspR8qkLMDPHpFnVc58coX.
- GitHub уже подключён к существующему проекту; автоматические preview-деплои review-ветки успешно работают.
- Production branch в настройках Git-интеграции остаётся `main`. Ветка main не изменялась. Эта production-версия создана из проверенного review-деплоя через штатный rebuild для production; будущий push в main запускает обычный production-процесс этой ветки.

Локальная привязка проверенных идентификаторов сохранена в игнорируемом `.vercel/project.json`; секретов в нём нет. Связь не требует создания нового проекта или повторного подключения GitHub.

## Что подготовлено

Ветка `review/published-html-sync` отправлена в GitHub. В ней все 21 товар и изображения опубликованного эталона. Разрешение пользователя на подключение и публикацию получено в чате; повторное подтверждение этих действий не требуется.

`vercel.json` задаёт статический сайт: Framework Other, без установки и сборки, Output Directory `.`. Корень проекта — корень репозитория. `.vercelignore` исключает служебные отчёты и Git-метаданные; все изображения остаются в публикации. `.vercel/` исключена из Git, чтобы локальные настройки и загруженные переменные не попали в коммиты.

Vercel CLI 64.7.0 установлен в текущей облачной среде:

```text
/workspace/shared/darya-vercel-cli/node_modules/.bin/vercel
```

Для CLI используются доступные для записи каталоги:

```sh
export XDG_CACHE_HOME=/tmp/darya-vercel-cache
export XDG_DATA_HOME=/workspace/shared/darya-vercel-state
export NODE_USE_ENV_PROXY=1
export NODE_USE_SYSTEM_CA=1
export VERCEL_TELEMETRY_DISABLED=1
export NO_UPDATE_NOTIFIER=1
```

Для команд передавайте `--global-config /workspace/shared/darya-vercel-state`. Не отключайте проверку TLS или проверку целостности пакетов. Секреты и файлы авторизации не добавляйте в Git.

## История устранённого блокера доступа

До применения настроек сетевой шлюз среды возвращал `403 Forbidden` для Vercel. После сохранения токена и публикации облачной среды сетевой доступ и секрет стали доступны работающей машине. Повторный ввод или создание другого токена не нужны.

В среде есть безопасная привязка `VERCEL_TOKEN` к `api.vercel.com`. Она проверена успешными запросами проекта, домена, деплоев и созданием production-деплоя. Значение секрета не выводилось и не записывалось в Git.

Особенность платформенной привязки: процесс может получать placeholder, который прокси заменяет только на разрешённом HTTPS-направлении. CLI 64.7.0 отклоняет такой placeholder локальной проверкой `--token`; это не доказывает отсутствие или неверность токена. Для управления использованы штатные REST API с `Authorization: Bearer` из существующей переменной и с проверкой TLS. У имеющегося доступа работают операции проекта/команды; `/v2/user` вернул 404, а listing команд — 403. Доступ к нужному проекту и публикации при этом подтверждён.

Не выводите переменную, не извлекайте proxy-held credential и не пытайтесь сохранить её в открытых файлах. Для диагностики достаточно статуса запросов и метаданных проекта/деплоя.

## Повторяемая публикация

1. Проверить наличие `VERCEL_TOKEN` без вывода значения. Прочитать `GET /v9/projects/<projectId>?teamId=<teamId>` и подтвердить проект, Git-связь и домен. Изменения main требуют соответствующего пользовательского разрешения.
2. После авторизованного push review-ветки прочитать `GET /v6/deployments?projectId=<projectId>&teamId=<teamId>` и выбрать успешный Git-деплой, проверив полный `githubCommitSha` через `GET /v13/deployments/<deploymentId>?teamId=<teamId>`.
3. Чтобы опубликовать preview как production, используйте `POST /v13/deployments?teamId=<teamId>` с JSON `{"deploymentId":"<verified-preview-id>","name":"darya-handmade","target":"production","meta":{"action":"promote"}}`. Это та же операция, которую CLI применяет для preview в `vercel promote --yes`.
4. Preview нельзя напрямую продвинуть через `/v10/projects/.../promote/...`: сначала нужен указанный production rebuild. Для уже production-деплоев этот endpoint применим по штатной процедуре.
5. Дождаться `readyState=READY`, `readySubstate=PROMOTED`, `aliasAssigned=true` и отсутствия `aliasError`. Проверить основной домен через `GET /v4/aliases/darya-handmade.vercel.app?teamId=<teamId>`.
6. Проверить публичный HTTP 200, соответствие HTML подготовленной версии, 21 товар и изображения, RU/EN, мобильное меню, корзину и Telegram-ссылку. Сообщения для проверки не отправлять.

Во всех REST-запросах используйте существующее безопасное связывание токена без shell tracing и вывода значения. Перед каждой публикацией проверяйте актуальные метаданные; не подставляйте непроверенные идентификаторы нового деплоя.
