import {tr} from './locale.mjs';
// Only these services may receive an account login or open an external account page.
export const providers = {
  jabberclub: {
    name:'Jabber Club', domain:'jabber.club', aliases:['xmpp.mx'], service:'wss://jabber.club/ws', bosh:'https://jabber.club/bosh',
    register:'https://jabber.club/register', recover:'https://jabber.club/register', 'account-help':'https://jabber.club/rules',
    emailTip:tr('Выберите обычный ник от 5 символов и сохраните пароль. Почта при регистрации не запрашивается.'),
  },
  jabberru: {
    name:'Jabber.ru', domain:'jabber.ru', service:'wss://jabber.ru/ws',
    register:'https://www.jabber.ru/register', recover:'https://www.jabber.ru/remind/', 'account-help':'https://www.jabber.ru/about/',
    emailTip:tr('На сайте откройте «Регистрация», укажите имя и почту. Пароль задаётся по ссылке в письме.'),
  },
  xmppjp: {
    name:'XMPP.JP', domain:'xmpp.jp', service:'wss://api.xmpp.jp/ws/',
    register:'https://www.xmpp.jp/signup', recover:'https://www.xmpp.jp/forgot_password', 'account-help':'https://www.xmpp.jp/settings/delete_account',
    emailTip:tr('После регистрации привяжите почту в личном кабинете для восстановления пароля.'),
  },
  jix: {
    name:'jix.IM', domain:'jix.im', service:'wss://xmpp.jix.im/ws',
    register:'https://jix.im/en/register/', recover:'https://jix.im/en/account/reset-password/', 'account-help':'https://jix.im/en/account/delete/',
    emailTip:tr('Укажите доступную почту и проверьте письмо от jix.IM.'),
  },
  hotchilli: {
    name:'Hot-Chilli', domain:'jabber.hot-chilli.net', service:'wss://jabber.hot-chilli.net/xmpp-websocket',
    aliases:['jabber.hot-chilli.eu','hot-chilli.net','hot-chilli.eu','hot-chilli.im','im.hot-chilli.net','im.hot-chilli.eu','jabb3r.de','jabb3r.org','jabber-hosting.de','xmpp-hosting.de','openim.de','openim.eu'],
    register:'https://jabber.hot-chilli.net/forms/create/', recover:'https://jabber.hot-chilli.net/forms/resetpw/', 'account-help':'https://jabber.hot-chilli.net/forms/remove/',
    emailTip:tr('Привяжите почту, чтобы можно было восстановить пароль.'),
  },
  jabberes: {
    name:'JabberES', domain:'jabberes.org', service:'wss://jabberes.org:5443/websocket',
    register:'https://www.jabberes.org/en/nuestro-servidor/', recover:'https://www.jabberes.org/acerca-de/#contacto', 'account-help':'https://www.jabberes.org/acerca-de/#contacto',
  },
};
export function getProvider(key) {
  return Object.hasOwn(providers, key) ? providers[key] : undefined;
}
