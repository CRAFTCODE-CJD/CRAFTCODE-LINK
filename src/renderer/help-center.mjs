import {language} from './locale.mjs';
import {helpText as t,guideSteps,helpTopics,tutorials} from './help-content.mjs';

export function bindHelpCenter({$,showDialog,closeDialog}){
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
  let step=0,guideOpener=null;
  $('guideTitle').tabIndex=-1;$('guideTitle').setAttribute('aria-describedby','guideText');
  function renderGuide(){
    const item=guideSteps[step];
    $('guideTitle').textContent=t(item.title);$('guideText').textContent=t(item.body);
    $('guideStep').textContent=(step+1)+' / '+guideSteps.length;
    $('guideBack').disabled=step===0;$('guideNext').textContent=t(step===guideSteps.length-1?['Готово','Done']:['Далее','Next']);
    $('guideIcon').setAttribute('href','#icon-'+item.icon);
    if($('linkGuide').open)$('guideTitle').focus({preventScroll:true});
  }
  function openGuide(){guideOpener=document.activeElement;$('helpVideo').pause();step=0;renderGuide();showDialog('linkGuide');$('guideTitle').focus({preventScroll:true});}
  for(const id of ['guideSettings','guideIntro','helpTutorial'])$(id).onclick=openGuide;
  $('guideBack').onclick=()=>{if(step>0)step--;renderGuide();};
  $('guideNext').onclick=()=>{if(step===guideSteps.length-1)closeDialog('linkGuide');else{step++;renderGuide();}};
  $('guideClose').onclick=$('guideSkip').onclick=()=>closeDialog('linkGuide');
  $('linkGuide').addEventListener('close',()=>{
    const target=guideOpener?.getClientRects().length?guideOpener:$('bookQuery');
    if(target?.getClientRects().length)target.focus({preventScroll:true});
    guideOpener=null;
  });
  $('guideSkip').textContent=t(['Пропустить','Skip']);
  $('firstStepsTitle').textContent=t(['Освойтесь за минуту','Get started in a minute']);
  $('firstStepsText').textContent=t(['Как добавить друга, написать сообщение и встретиться в звонке или игре. Обучение всегда доступно через «?».','Learn to add a friend, send a message and meet in a call or game. You can always open this guide from ?.']);
  $('firstStepsOpen').textContent=t(['Показать первые шаги','Show first steps']);
  $('firstStepsSkip').textContent=t(['Позже','Later']);
  $('helpIntro').textContent=t(['Друзья, разговоры и игры — в одном месте. Найдите ответ или посмотрите короткий пример.','Friends, conversations and games in one place. Find an answer or watch a short example.']);
  $('helpTutorial').textContent=t(['Первые шаги','First steps']);
  $('helpSearch').placeholder=t(['Найти в справке: микрофон, файлы, LAN…','Search help: microphone, files, LAN…']);
  $('helpSearch').ariaLabel=t(['Поиск по справке','Search help']);
  $('helpNothing').textContent=t(['Ничего не найдено. Попробуйте другое слово или откройте диагностику ниже.','No matches. Try another word or open diagnostics below.']);
  $('helpExamplesTitle').textContent=t(['Короткие примеры','Short examples']);
  $('helpExamplesNote').textContent=t(['Записано в LINK с демонстрационными профилями. Видео без звука, запускаются только по нажатию.','Recorded in LINK with demonstration profiles. Videos are silent and only play when you choose.']);
  $('helpVideos').ariaLabel=t(['Выберите пример','Choose an example']);
  for(const topic of helpTopics){
    const details=node('details');details.dataset.helpTopic=topic.id;
    details.append(node('summary',t(topic.title)));
    for(const paragraph of topic.paragraphs)details.append(node('p',t(paragraph)));
    $('helpArticles').append(details);
  }
  const articles=[$('helpFriendArticle'),...$('helpArticles').children];
  function filter(){
    const words=$('helpSearch').value.trim().toLocaleLowerCase(language).split(/\s+/u).filter(Boolean);
    let count=0;
    for(const article of articles){
      const match=words.every(word=>article.textContent.toLocaleLowerCase(language).includes(word));
      article.hidden=!match;if(match)count++;
      if(words.length)article.open=match;
    }
    $('helpNothing').hidden=count>0;
  }
  $('helpSearch').oninput=filter;
  const video=$('helpVideo');
  const stop=()=>video.pause();
  function selectClip(item){
    stop();video.removeAttribute('src');video.replaceChildren();
    video.poster='assets/tutorials/'+item.id+'.jpg';
    video.src='assets/tutorials/'+item.id+'.mp4';
    const track=node('track');track.kind='captions';track.srclang=language;track.label=language==='en'?'English':'Русский';
    track.src='assets/tutorials/'+item.id+'.'+language+'.vtt';track.default=true;video.append(track);
    video.load();$('helpVideoTitle').textContent=t(item.title);$('helpVideoDescription').textContent=t(item.description);
    $('helpVideoError').hidden=true;
    for(const button of $('helpVideos').children)button.setAttribute('aria-pressed',String(button.dataset.clip===item.id));
  }
  for(const item of tutorials){
    const button=node('button',t(item.title),'button button-secondary');button.type='button';button.dataset.clip=item.id;
    button.onclick=()=>selectClip(item);$('helpVideos').append(button);
  }
  $('helpVideoError').textContent=t(['Не удалось открыть пример. Инструкция под видео и разделы справки остаются доступны.','This example could not be opened. The description below and help articles are still available.']);
  video.addEventListener('error',()=>{$('helpVideoError').hidden=false;});
  $('helpExamplesTitle').addEventListener('click',()=>{if($('helpExamples').open)stop();});
  $('helpExamples').addEventListener('toggle',()=>{if(!$('helpExamples').open)stop();});
  $('helpConnectivity').addEventListener('click',stop);
  $('networkDialog').addEventListener('close',()=>{
    stop();$('helpSearch').value='';for(const article of articles){article.hidden=false;article.open=false;}$('helpNothing').hidden=true;
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  // No autoplay: reduced motion, opening Help and switching clips all stay still.
  selectClip(tutorials[0]);
  return {openGuide};
}
