(() => {
  "use strict";
  const PAGE_SIZE = 50;
  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), pagination = $("pagination"), viewer = $("viewer"), viewerMedia = $("viewerMedia");
  const profilePhotoUrl = mediaUrl(PROFILE_PHOTO_PATH);
  $("profilePhoto").src = profilePhotoUrl; $("viewerAvatar").src = profilePhotoUrl;
  $("postCount").textContent = posts.length.toLocaleString();
  const byId = new Map(posts.map((post, index) => [post.id, {post, index}]));
  let currentPage = 1, activeIndex = -1, activeMediaIndex = 0, gridObserver = null, opened = false;
  const mediaObservers = new Set();
  function pageFromUrl(){ const n=Number(new URL(location.href).searchParams.get("page")); return Number.isInteger(n)&&n>0&&n<=Math.max(1,Math.ceil(posts.length/PAGE_SIZE))?n:1; }
  function urlForPage(page){ const u=new URL(location.href); if(page<=1)u.searchParams.delete("page");else u.searchParams.set("page",String(page));u.searchParams.delete("post");return u; }
  function setStatus(text){$("status").textContent=text||"";}
  function makeThumbnail(post,index){
    const button=document.createElement("button");button.className="grid-item";button.type="button";button.dataset.index=String(index);button.setAttribute("aria-label",`Open post ${index+1}`);
    const file=post.files[0], url=mediaUrl(file);
    if(/\.(mp4|webm)$/i.test(file)){
      const video=document.createElement("video");video.muted=true;video.playsInline=true;video.preload="none";video.setAttribute("aria-label","Video thumbnail");video.dataset.src=url;video.loading="lazy";button.append(video);
      const mark=document.createElement("span");mark.className="video-mark";mark.textContent="▻";button.append(mark);
    }else{const img=document.createElement("img");img.alt="";img.loading="lazy";img.decoding="async";img.dataset.src=url;button.append(img);}
    if(post.files.length>1){const mark=document.createElement("span");mark.className="carousel-mark";mark.textContent="▧";button.append(mark);}
    button.addEventListener("click",()=>openPost(index,true));return button;
  }
  function setupLazyMedia(){
    if(gridObserver)gridObserver.disconnect();
    const targets=grid.querySelectorAll("[data-src]");
    if(!("IntersectionObserver" in window)){targets.forEach(loadThumb);return;}
    gridObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){loadThumb(entry.target);gridObserver.unobserve(entry.target);}}),{rootMargin:"250px"});
    targets.forEach(el=>gridObserver.observe(el));
  }
  function loadThumb(el){if(!el.isConnected||!el.dataset.src)return;el.src=el.dataset.src;delete el.dataset.src;if(el.tagName==="VIDEO"){el.addEventListener("error",()=>{el.style.opacity=".15";},{once:true});el.preload="metadata";}}
  function renderPage(page,updateUrl=true){
    if(gridObserver){gridObserver.disconnect();gridObserver=null;}
    grid.replaceChildren();pagination.replaceChildren();currentPage=Math.max(1,Math.min(page,Math.max(1,Math.ceil(posts.length/PAGE_SIZE))));
    const start=(currentPage-1)*PAGE_SIZE, end=Math.min(start+PAGE_SIZE,posts.length), fragment=document.createDocumentFragment();
    for(let i=start;i<end;i++)fragment.append(makeThumbnail(posts[i],i));grid.append(fragment);setupLazyMedia();renderPagination();
    if(updateUrl)history.pushState({page:currentPage},"",urlForPage(currentPage));setStatus(posts.length?`${start+1}–${end} of ${posts.length} posts`:"No media files found.");
    if(opened)closeViewer(false);window.scrollTo({top:0,behavior:"auto"});
  }
  function renderPagination(){
    const total=Math.ceil(posts.length/PAGE_SIZE);if(total<=1)return;
    const add=(label,page,disabled=false,active=false)=>{const b=document.createElement("button");b.className="page-button"+(active?" active":"");b.textContent=label;b.disabled=disabled;b.setAttribute("aria-label",label==="…"?"More pages":`Page ${label}`);if(!disabled&&label!=="…")b.addEventListener("click",()=>renderPage(page));pagination.append(b);};
    add("Previous",currentPage-1,currentPage===1);
    const nums=new Set([1,total,currentPage,currentPage-1,currentPage+1,currentPage-2,currentPage+2].filter(n=>n>=1&&n<=total));let prev=0;
    [...nums].sort((a,b)=>a-b).forEach(n=>{if(prev&&n-prev>1)add("…",n,true);add(String(n),n,false,n===currentPage);prev=n;});
    add("Next",currentPage+1,currentPage===total);
  }
  function cleanupMedia(){viewerMedia.querySelectorAll("video").forEach(v=>{try{v.pause();v.removeAttribute("src");v.load();}catch(e){}});viewerMedia.replaceChildren();}
  function showMedia(){
    cleanupMedia();const post=posts[activeIndex];activeMediaIndex=Math.max(0,Math.min(activeMediaIndex,post.files.length-1));const file=post.files[activeMediaIndex],url=mediaUrl(file);
    if(/\.(mp4|webm)$/i.test(file)){
      const v=document.createElement("video");v.controls=true;v.playsInline=true;v.preload="none";v.controlsList="nodownload";v.setAttribute("aria-label","Post video");v.style.objectFit="contain";v.src=url;
      v.addEventListener("error",()=>{if(!v.isConnected)return;const e=document.createElement("div");e.className="media-error";e.textContent="This video could not be loaded. The file may be missing or unsupported.";viewerMedia.replaceChildren(e);},{once:true});
      viewerMedia.append(v);const playPromise=v.play();if(playPromise&&playPromise.catch)playPromise.catch(()=>{});
    }else{const img=document.createElement("img");img.alt="Hena post photograph";img.decoding="async";img.src=url;img.addEventListener("error",()=>{if(!img.isConnected)return;const e=document.createElement("div");e.className="media-error";e.textContent="This image could not be loaded. Check that the file exists in the repository.";viewerMedia.replaceChildren(e);},{once:true});viewerMedia.append(img);}
    const multi=post.files.length>1;$("carouselControls").hidden=!multi;$("carouselPosition").textContent=`${activeMediaIndex+1}/${post.files.length}`;$("carouselPrev").disabled=activeMediaIndex===0;$("carouselNext").disabled=activeMediaIndex===post.files.length-1;
  }
  function syncViewerUrl(){const u=new URL(location.href);u.searchParams.set("post",posts[activeIndex].id);u.searchParams.delete("page");history.replaceState({post:posts[activeIndex].id},"",u);}
  function openPost(index,updateUrl){activeIndex=index;activeMediaIndex=0;opened=true;viewer.hidden=false;document.body.classList.add("viewer-open");$("viewerCaption").replaceChildren();const post=posts[index];if(post.caption){const name=document.createElement("span");name.className="caption-user";name.textContent="hennaah.11";$("viewerCaption").append(name,document.createTextNode(post.caption));}$("viewerDate").textContent=post.timestamp||"";$("likeButton").classList.remove("liked");$("saveButton").classList.remove("liked");showMedia();$("previousPost").disabled=index===0;$("nextPost").disabled=index===posts.length-1;if(updateUrl)syncViewerUrl();else{const u=new URL(location.href);u.searchParams.set("post",post.id);history.replaceState({post:post.id},"",u);}$("linkStatus").textContent="";$("closeViewer").focus();}
  function closeViewer(updateUrl=true){if(!opened)return;opened=false;viewer.hidden=true;cleanupMedia();document.body.classList.remove("viewer-open");if(updateUrl){const u=new URL(location.href);u.searchParams.delete("post");if(currentPage>1)u.searchParams.set("page",String(currentPage));history.pushState({page:currentPage},"",u);}const tile=grid.querySelector(`[data-index="${activeIndex}"]`);if(tile)tile.focus({preventScroll:true});}
  function stepPost(delta){const n=activeIndex+delta;if(n<0||n>=posts.length)return;const targetPage=Math.floor(n/PAGE_SIZE)+1;if(targetPage!==currentPage)renderPage(targetPage,false);openPost(n,true);}
  function stepCarousel(delta){const post=posts[activeIndex],next=activeMediaIndex+delta;if(next<0||next>=post.files.length)return;activeMediaIndex=next;showMedia();}
  $("closeViewer").addEventListener("click",()=>closeViewer());$("previousPost").addEventListener("click",()=>stepPost(-1));$("nextPost").addEventListener("click",()=>stepPost(1));$("carouselPrev").addEventListener("click",()=>stepCarousel(-1));$("carouselNext").addEventListener("click",()=>stepCarousel(1));
  viewer.addEventListener("click",e=>{if(e.target===viewer)closeViewer();});document.addEventListener("keydown",e=>{if(!opened)return;if(e.key==="Escape")closeViewer();if(e.key==="ArrowLeft")stepCarousel(activeMediaIndex>0?-1:0);if(e.key==="ArrowRight")stepCarousel(activeMediaIndex<posts[activeIndex].files.length-1?1:0);});
  $("likeButton").addEventListener("click",()=>{$("likeButton").classList.toggle("liked");$("likeButton").textContent=$("likeButton").classList.contains("liked")?"♥":"♡";});$("saveButton").addEventListener("click",()=>$("saveButton").classList.toggle("liked"));$("shareButton").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(location.href);$("linkStatus").textContent="Post link copied";}catch(e){$("linkStatus").textContent="Copy the address bar link to share";}});
  $("themeToggle").addEventListener("click",()=>{document.body.classList.toggle("dark");localStorage.setItem("hena-dark",document.body.classList.contains("dark")?"1":"0");});if(localStorage.getItem("hena-dark")==="1")document.body.classList.add("dark");
  $("followButton").addEventListener("click",()=>{const b=$("followButton"),on=b.dataset.following==="1";b.dataset.following=on?"0":"1";b.textContent=on?"Follow":"Following";b.style.background=on?"var(--button)":"var(--hover)";b.style.color=on?"#fff":"var(--text)";});
  // A light touch swipe recognizer for carousel media; native video gestures remain available.
  let touchX=0;viewerMedia.addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;},{passive:true});viewerMedia.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>65&&posts[activeIndex].files.length>1)stepCarousel(dx<0?1:-1);},{passive:true});
  window.addEventListener("popstate",()=>{const u=new URL(location.href),pid=u.searchParams.get("post"),entry=pid?byId.get(pid):null;if(entry){const page=Math.floor(entry.index/PAGE_SIZE)+1;if(page!==currentPage)renderPage(page,false);openPost(entry.index,false);}else{if(opened)closeViewer(false);renderPage(pageFromUrl(),false);}});
  renderPage(pageFromUrl(),false);const initialPost=new URL(location.href).searchParams.get("post");if(initialPost&&byId.has(initialPost)){const entry=byId.get(initialPost);const page=Math.floor(entry.index/PAGE_SIZE)+1;if(page!==currentPage)renderPage(page,false);openPost(entry.index,false);}
})();
