import {
    COSMOS_THEME_ID,
    COSMOS_THEME_STORAGE_KEY,
} from "./theme";

/**
 * 静态引导脚本：在 React 水合与首屏绘制之前把最终主题属性写到 `<html>`，
 * 避免错误配色闪烁。脚本只包含仓库常量，不插入任何用户输入；
 * localStorage / matchMedia 异常时回退 macos-light，绝不阻止页面启动。
 */
export const COSMOS_THEME_BOOTSTRAP_SCRIPT = `(function(){try{var K=${JSON.stringify(COSMOS_THEME_STORAGE_KEY)},T=${JSON.stringify(COSMOS_THEME_ID)},L="macos-light",N="macos-night";var p=null,f=0,m=null;try{p=window.localStorage.getItem(K)}catch(e){f=1}if(!f&&p!==L&&p!==N)p="system";try{m=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}var c=(f||m===null)?L:(p===N?N:p===L?L:(m?N:L));var r=document.documentElement;r.setAttribute("data-cosmos-theme",T);r.setAttribute("data-cosmos-colorway",c);r.classList.toggle("dark",c===N);r.style.colorScheme=c===N?"dark":"light";}catch(e){}})();`;
