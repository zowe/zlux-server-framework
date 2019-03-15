package org.zowe.java.ms.example;

import java.io.IOException;
import java.io.StringReader;
import java.net.URI;

import javax.servlet.ServletConfig;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.http.HttpEntity;
import org.apache.http.client.config.CookieSpecs;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.conn.ssl.NoopHostnameVerifier;
import org.apache.http.conn.ssl.SSLConnectionSocketFactory;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.ssl.SSLContextBuilder;
import org.apache.http.util.EntityUtils;

import javax.json.Json;
import javax.json.JsonObject;
import javax.json.JsonObjectBuilder;
import javax.json.JsonReader;

/**
 * Servlet implementation class HelloWorld
 */
@WebServlet("/")
public class HelloWorld extends HttpServlet {
    private static final long serialVersionUID = Math.round(Long.MAX_VALUE*Math.random());
    private static final String zluxUrl = System.getenv("ZOWE_ZLUX_URL");
       
    /**
     * @see HttpServlet#HttpServlet()
     */
    public HelloWorld() {
        super();
    }

    /**
     * @see Servlet#init(ServletConfig)
     */
    public void init(ServletConfig config) throws ServletException { }

    /**
     * @see Servlet#destroy()
     */
    public void destroy() {
        log("Servlet shutdown");
    }

    /**
     * @see HttpServlet#doGet(HttpServletRequest request, HttpServletResponse response)
     */
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        String username = "";
        JsonObjectBuilder builder = Json.createObjectBuilder();
        builder.add("id", ""+serialVersionUID);
		
        if (HelloWorld.zluxUrl.length() != 0) {
            URI uri = URI.create(HelloWorld.zluxUrl+"/auth");
            /*
              try {
              uri = new URIBuilder()
              .setScheme("http")
              .setHost("www.google.com")
              .setPath("/search")
              .setParameter("q", "httpclient")
              .setParameter("btnG", "Google Search")
              .setParameter("aq", "f")
              .setParameter("oq", "")
              .build();
              } catch (URISyntaxException e) {
              // TODO Auto-generated catch block
              e.printStackTrace();
              }
            */
            System.out.println("Doing a GET to "+uri.toString());

            HttpGet get = new HttpGet(uri);
            get.addHeader("Cookie", request.getHeader("Cookie"));
            System.out.println("Using cookie:"+get.getFirstHeader("Cookie").getValue());
            CloseableHttpResponse zluxResponse = null;
            try {
                SSLContextBuilder sslBuilder = new SSLContextBuilder();
                sslBuilder.loadTrustMaterial(null, (chain, authType) -> true);           
                SSLConnectionSocketFactory sslsf = new 
                    SSLConnectionSocketFactory(sslBuilder.build(), NoopHostnameVerifier.INSTANCE);
                CloseableHttpClient httpclient = HttpClients.custom().setDefaultRequestConfig(RequestConfig.custom()
                                                                                              .setCookieSpec(CookieSpecs.STANDARD).build()).setSSLSocketFactory(sslsf).build();
                zluxResponse = httpclient.execute(get);
				
                int code = zluxResponse.getStatusLine().getStatusCode();
                if (code == 200) {
                    HttpEntity entity = zluxResponse.getEntity();
                    if (entity != null) {
                        String jsonString = EntityUtils.toString(entity);
                        System.out.println("JSON received is="+jsonString);
                        //log("JSON received is="+jsonString);
                        try {
                            JsonReader jsonReader = Json.createReader(new StringReader(jsonString));
                            JsonObject jsonObject = jsonReader.readObject();
                            jsonReader.close();
                            username = jsonObject.getJsonObject("categories").getJsonObject("zss").
                                getJsonObject("plugins").getJsonObject("org.zowe.zlux.auth.zss").getString("username");
                        } catch (Exception e) {
                            builder.add("Error", "No username given from zlux");
                        }
                        /*
                         * 
                         * {"categories":{"zss":{"success":true,"plugins":{"org.zowe.zlux.auth.zss":{"success":true,"username":"me","expms":36000000}}}},"success":true}
                         */
                    }
                } else {
                    builder.add("Error", "zlux return code="+code);
                }
            } catch (Exception e) {
                response.setStatus(500);
                e.printStackTrace();
                JsonObject json = builder.add("Error", e.toString()).build();
                if (zluxResponse != null) {
                    zluxResponse.close();
                }
                response.getWriter().print(json.toString());
                return;
            }
            zluxResponse.close();
        }
        JsonObject json = builder.add("Hello", username).build();
        response.setStatus(200);
        response.getWriter().print(json.toString());
    }

}
