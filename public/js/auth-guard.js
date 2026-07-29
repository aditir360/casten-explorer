import { supabase } from "./casten-auth.js";

export async function requireAuth(){

    const { data } = await supabase.auth.getSession();

    if(!data.session){

        window.location.href =
        "login.html";

        return false;
    }

    return true;
}
