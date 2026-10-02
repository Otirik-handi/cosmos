import { COSMOS_THEME_STORAGE_KEY } from "./theme";

/**
 * 静态引导脚本：在 React 水合与首屏绘制之前把最终明暗属性写到 `<html>`，
 * 避免错误配色闪烁。脚本只包含仓库常量，不插入任何用户输入；
 * localStorage / matchMedia 异常时回退亮色，绝不阻止页面启动。
 */
export const COSMOS_THEME_BOOTSTRAP_SCRIPT = `(function(){try{var K=${JSON.stringify(COSMOS_THEME_STORAGE_KEY)},L="light",D="dark";var p=null,f=0,m=null;try{p=window.localStorage.getItem(K)}catch(e){f=1}if(!f&&p!==L&&p!==D)p="system";try{m=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}var a=(f||m===null)?L:(p===D?D:p===L?L:(m?D:L));var r=document.documentElement;r.setAttribute("data-cosmos-appearance",a);r.classList.toggle("dark",a===D);r.style.colorScheme=a;}catch(e){}})();`;
