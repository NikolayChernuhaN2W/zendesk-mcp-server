import { z } from 'zod';
    import { zendeskClient } from '../zendesk-client.js';
    import { jsonResult, summarizeArticle } from '../format.js';

    export const helpCenterTools = [
      {
        name: "list_articles",
        description: "List Help Center articles",
        schema: {
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of articles per page (max 100)"),
          sort_by: z.string().optional().describe("Field to sort by"),
          sort_order: z.enum(["asc", "desc"]).optional().describe("Sort order (asc or desc)")
        },
        handler: async ({ page, per_page, sort_by, sort_order }) => {
          try {
            const params = { page, per_page, sort_by, sort_order };
            const result = await zendeskClient.listArticles(params);
            return jsonResult({
              articles: result.articles.map(article => summarizeArticle(article)),
              count: result.count,
              next_page: result.next_page
            });
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error listing articles: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "get_article",
        description: "Get a specific Help Center article by ID",
        schema: {
          id: z.number().describe("Article ID"),
          raw: z.boolean().optional().describe("Return the full Zendesk API object (HTML body) instead of a summary")
        },
        handler: async ({ id, raw = false }) => {
          try {
            const result = await zendeskClient.getArticle(id);
            return jsonResult(raw ? result : summarizeArticle(result.article, { bodyLength: Infinity }));
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting article: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "search_articles",
        description: "Search Help Center articles by keyword. Returns titles, links and matching snippets; use get_article for an article's full text",
        schema: {
          query: z.string().describe("Words to search for"),
          locale: z.string().optional().describe("Only articles in this locale, e.g. 'en-us'"),
          category_id: z.number().optional().describe("Only articles in this category"),
          section_id: z.number().optional().describe("Only articles in this section"),
          label_names: z.array(z.string()).optional().describe("Only articles with any of these labels (Professional and Enterprise plans only)"),
          updated_after: z.string().optional().describe("Only articles updated after this date (YYYY-MM-DD)"),
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of articles per page (max 100)")
        },
        handler: async ({ query, locale, category_id, section_id, label_names, updated_after, page, per_page }) => {
          try {
            const result = await zendeskClient.searchArticles({
              query,
              locale,
              category: category_id,
              section: section_id,
              label_names: label_names?.join(','),
              updated_after,
              page,
              per_page
            });
            return jsonResult({
              articles: result.results.map(article => summarizeArticle(article)),
              count: result.count,
              next_page: result.next_page
            });
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error searching articles: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "create_article",
        description: "Create a new Help Center article",
        schema: {
          title: z.string().describe("Article title"),
          body: z.string().describe("Article body content (HTML)"),
          section_id: z.number().describe("Section ID where the article will be created"),
          locale: z.string().optional().describe("Article locale (e.g., 'en-us')"),
          draft: z.boolean().optional().describe("Whether the article is a draft"),
          permission_group_id: z.number().optional().describe("Permission group ID for the article"),
          user_segment_id: z.number().optional().describe("User segment ID for the article"),
          label_names: z.array(z.string()).optional().describe("Labels for the article")
        },
        handler: async ({ title, body, section_id, locale, draft, permission_group_id, user_segment_id, label_names }) => {
          try {
            const articleData = {
              title,
              body,
              locale,
              draft,
              permission_group_id,
              user_segment_id,
              label_names
            };
            
            const result = await zendeskClient.createArticle(articleData, section_id);
            return {
              content: [{ 
                type: "text", 
                text: `Article created successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error creating article: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "update_article",
        description: "Update an existing Help Center article",
        schema: {
          id: z.number().describe("Article ID to update"),
          title: z.string().optional().describe("Updated article title"),
          body: z.string().optional().describe("Updated article body content (HTML)"),
          locale: z.string().optional().describe("Which translation to update, e.g. 'en-us' (defaults to the article's source locale)"),
          draft: z.boolean().optional().describe("Whether the article is a draft"),
          permission_group_id: z.number().optional().describe("Updated permission group ID"),
          user_segment_id: z.number().optional().describe("Updated user segment ID"),
          label_names: z.array(z.string()).optional().describe("Updated labels")
        },
        handler: async ({ id, title, body, locale, draft, permission_group_id, user_segment_id, label_names }) => {
          try {
            const translationData = {};
            const articleData = {};

            if (title !== undefined) translationData.title = title;
            if (body !== undefined) translationData.body = body;
            if (draft !== undefined) translationData.draft = draft;
            if (permission_group_id !== undefined) articleData.permission_group_id = permission_group_id;
            if (user_segment_id !== undefined) articleData.user_segment_id = user_segment_id;
            if (label_names !== undefined) articleData.label_names = label_names;

            if (!Object.keys(translationData).length && !Object.keys(articleData).length) {
              return {
                content: [{ type: "text", text: "Nothing to update: pass at least one field to change." }],
                isError: true
              };
            }

            const result = {};
            if (Object.keys(translationData).length) {
              const targetLocale = locale || (await zendeskClient.getArticle(id)).article.source_locale;
              Object.assign(result, await zendeskClient.updateArticleTranslation(id, targetLocale, translationData));
            }
            if (Object.keys(articleData).length) {
              Object.assign(result, await zendeskClient.updateArticle(id, articleData));
            }

            return {
              content: [{ 
                type: "text", 
                text: `Article updated successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error updating article: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "delete_article",
        description: "Delete a Help Center article",
        schema: {
          id: z.number().describe("Article ID to delete")
        },
        handler: async ({ id }) => {
          try {
            await zendeskClient.deleteArticle(id);
            return {
              content: [{ 
                type: "text", 
                text: `Article ${id} deleted successfully!`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error deleting article: ${error.message}` }],
              isError: true
            };
          }
        }
      }
    ];
